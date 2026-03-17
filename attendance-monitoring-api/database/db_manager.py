"""
db_manager.py
-------------
Async SQLite database manager using SQLAlchemy 2.x + aiosqlite.

Schema
------
  users
    id            TEXT  PRIMARY KEY   (UUID or employee ID string)
    name          TEXT  NOT NULL
    embedding_vector  TEXT  NOT NULL  (JSON-encoded float32 list)
    created_at    TEXT  NOT NULL

  attendance
    id            INTEGER  PRIMARY KEY  AUTOINCREMENT
    user_id       TEXT     NOT NULL  REFERENCES users(id)
    timestamp     TEXT     NOT NULL
    status        TEXT     NOT NULL  DEFAULT 'present'
    confidence    REAL

Public API
----------
  await DBManager.create()                    → factory (creates tables)
  await db.upsert_user(id, name, embedding)   → register / update user
  await db.get_all_users_with_embeddings()    → list for FAISS rebuild
  await db.get_user(user_id)                  → single user dict
  await db.delete_user(user_id)              → remove user + embeddings
  await db.log_attendance(user_id, confidence, status) → write attendance
  await db.get_attendance(...)                → query attendance records
  await db.close()                            → clean up
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from loguru import logger
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


# ---------------------------------------------------------------------------
# SQL DDL
# ---------------------------------------------------------------------------

_CREATE_USERS_TABLE = """
CREATE TABLE IF NOT EXISTS users (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    embedding_vector TEXT   NOT NULL,
    created_at      TEXT    NOT NULL
);
"""

_CREATE_ATTENDANCE_TABLE = """
CREATE TABLE IF NOT EXISTS attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT    NOT NULL,
    timestamp   TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'present',
    confidence  REAL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
"""

_CREATE_IDX_ATTENDANCE_USER = """
CREATE INDEX IF NOT EXISTS idx_attendance_user_id
ON attendance (user_id);
"""

_CREATE_IDX_ATTENDANCE_TIME = """
CREATE INDEX IF NOT EXISTS idx_attendance_timestamp
ON attendance (timestamp);
"""


# ---------------------------------------------------------------------------
# DBManager
# ---------------------------------------------------------------------------

class DBManager:
    """
    Async SQLite database layer for the attendance monitoring system.

    Always use the class method ``DBManager.create()`` instead of the
    constructor directly::

        db = await DBManager.create("database/embeddings.db")
    """

    def __init__(self, engine: AsyncEngine, session_factory):
        self._engine = engine
        self._session_factory = session_factory

    # ------------------------------------------------------------------
    @classmethod
    async def create(cls, db_path: str = "database/embeddings.db") -> "DBManager":
        """
        Factory method: creates the database file (+ all tables if needed)
        and returns a ready-to-use DBManager.
        """
        db_file = Path(db_path)
        db_file.parent.mkdir(parents=True, exist_ok=True)

        url = f"sqlite+aiosqlite:///{db_file.resolve()}"
        engine = create_async_engine(url, echo=False, future=True)

        # Enable WAL mode and foreign keys
        async with engine.begin() as conn:
            await conn.execute(text("PRAGMA journal_mode=WAL;"))
            await conn.execute(text("PRAGMA foreign_keys=ON;"))
            await conn.execute(text(_CREATE_USERS_TABLE))
            await conn.execute(text(_CREATE_ATTENDANCE_TABLE))
            await conn.execute(text(_CREATE_IDX_ATTENDANCE_USER))
            await conn.execute(text(_CREATE_IDX_ATTENDANCE_TIME))

        session_factory = sessionmaker(
            engine, class_=AsyncSession, expire_on_commit=False
        )
        logger.info(f"Database ready at: {db_file.resolve()}")
        return cls(engine, session_factory)

    # ------------------------------------------------------------------
    async def close(self) -> None:
        """Dispose the async engine (release connections)."""
        await self._engine.dispose()

    # ------------------------------------------------------------------
    # Users
    # ------------------------------------------------------------------

    async def upsert_user(
        self,
        user_id: str,
        name: str,
        embedding: np.ndarray,
    ) -> Dict[str, Any]:
        """
        Insert or replace a user record.

        Args:
            user_id:    Unique user identifier string.
            name:       Display name.
            embedding:  512-D float32 numpy vector.

        Returns:
            Dict representation of the stored user.
        """
        emb_json = json.dumps(embedding.astype(np.float32).tolist())
        now = _utcnow()

        sql = text(
            """
            INSERT INTO users (id, name, embedding_vector, created_at)
            VALUES (:id, :name, :emb, :created_at)
            ON CONFLICT(id) DO UPDATE SET
                name             = excluded.name,
                embedding_vector = excluded.embedding_vector
            """
        )

        async with self._session_factory() as session:
            async with session.begin():
                await session.execute(
                    sql,
                    {
                        "id":         user_id,
                        "name":       name,
                        "emb":        emb_json,
                        "created_at": now,
                    },
                )

        logger.debug(f"Upserted user id={user_id!r} name={name!r}")
        return {"id": user_id, "name": name, "created_at": now}

    async def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a single user by id.  Returns None if not found."""
        sql = text("SELECT id, name, embedding_vector, created_at FROM users WHERE id = :id")
        async with self._session_factory() as session:
            row = (await session.execute(sql, {"id": user_id})).one_or_none()
        if row is None:
            return None
        return _row_to_user_dict(row)

    async def get_all_users(self) -> List[Dict[str, Any]]:
        """Return all users WITHOUT the embedding vector (for list endpoints)."""
        sql = text("SELECT id, name, created_at FROM users ORDER BY name")
        async with self._session_factory() as session:
            rows = (await session.execute(sql)).all()
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    async def get_all_users_with_embeddings(self) -> List[Dict[str, Any]]:
        """
        Return all users INCLUDING their embedding vectors.
        Used by RecognitionEngine.load_embeddings_from_db().
        """
        sql = text("SELECT id, name, embedding_vector, created_at FROM users")
        async with self._session_factory() as session:
            rows = (await session.execute(sql)).all()
        return [_row_to_user_dict(r) for r in rows]

    async def delete_user(self, user_id: str) -> bool:
        """
        Delete a user and cascade-delete their attendance records.

        Returns True if the user existed, False otherwise.
        """
        check_sql  = text("SELECT COUNT(*) FROM users WHERE id = :id")
        delete_sql = text("DELETE FROM users WHERE id = :id")

        async with self._session_factory() as session:
            async with session.begin():
                count = (
                    await session.execute(check_sql, {"id": user_id})
                ).scalar_one()
                if count == 0:
                    return False
                await session.execute(delete_sql, {"id": user_id})

        logger.info(f"Deleted user id={user_id!r}")
        return True

    # ------------------------------------------------------------------
    # Attendance
    # ------------------------------------------------------------------

    async def log_attendance(
        self,
        user_id: str,
        confidence: float = 0.0,
        status: str = "present",
        timestamp: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Write an attendance record.

        Args:
            user_id:    Must match an existing user id.
            confidence: Recognition confidence (cosine similarity).
            status:     "present" | "late" | "absent" — default "present".
            timestamp:  ISO-8601 string; defaults to UTC now.

        Returns:
            Dict with the new attendance record.
        """
        ts = timestamp or _utcnow()
        sql = text(
            """
            INSERT INTO attendance (user_id, timestamp, status, confidence)
            VALUES (:user_id, :timestamp, :status, :confidence)
            """
        )
        async with self._session_factory() as session:
            async with session.begin():
                result = await session.execute(
                    sql,
                    {
                        "user_id":    user_id,
                        "timestamp":  ts,
                        "status":     status,
                        "confidence": confidence,
                    },
                )
                record_id = result.lastrowid

        return {
            "id":         record_id,
            "user_id":    user_id,
            "timestamp":  ts,
            "status":     status,
            "confidence": confidence,
        }

    async def get_attendance(
        self,
        user_id: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        """
        Query attendance records with optional filters.

        Args:
            user_id:    Filter by user.
            date_from:  ISO date string "YYYY-MM-DD" (inclusive).
            date_to:    ISO date string "YYYY-MM-DD" (inclusive).
            limit:      Maximum rows to return.
        """
        conditions = []
        params: Dict[str, Any] = {"limit": limit}

        if user_id:
            conditions.append("a.user_id = :user_id")
            params["user_id"] = user_id
        if date_from:
            conditions.append("a.timestamp >= :date_from")
            params["date_from"] = date_from
        if date_to:
            conditions.append("a.timestamp <= :date_to")
            params["date_to"] = date_to + "T23:59:59"

        where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        sql = text(
            f"""
            SELECT a.id, a.user_id, u.name, a.timestamp, a.status, a.confidence
            FROM attendance a
            JOIN users u ON u.id = a.user_id
            {where_clause}
            ORDER BY a.timestamp DESC
            LIMIT :limit
            """
        )

        async with self._session_factory() as session:
            rows = (await session.execute(sql, params)).all()

        return [
            {
                "id":         r[0],
                "user_id":    r[1],
                "name":       r[2],
                "timestamp":  r[3],
                "status":     r[4],
                "confidence": r[5],
            }
            for r in rows
        ]

    async def has_attended_today(self, user_id: str) -> bool:
        """Return True if the user already has an attendance record today (UTC)."""
        today = datetime.now(timezone.utc).date().isoformat()
        sql = text(
            """
            SELECT COUNT(*) FROM attendance
            WHERE user_id = :user_id
              AND timestamp >= :today
            """
        )
        async with self._session_factory() as session:
            count = (
                await session.execute(sql, {"user_id": user_id, "today": today})
            ).scalar_one()
        return count > 0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_user_dict(row) -> Dict[str, Any]:
    """Convert a DB row (id, name, embedding_vector, created_at) to dict."""
    emb_list = json.loads(row[2])
    return {
        "id":               row[0],
        "name":             row[1],
        "embedding_vector": emb_list,
        "created_at":       row[3],
    }
