import { NextRequest, NextResponse } from 'next/server'

const DEFAULT_FACENET_BASE = 'https://attendance-monitoring-api-production.up.railway.app'

function getFacenetBase(): string {
  const base = process.env.NEXT_PUBLIC_FACENET_API_URL || DEFAULT_FACENET_BASE
  return base.replace(/\/$/, '')
}

function buildTargetUrl(pathSegments: string[], search: string): string {
  const base = getFacenetBase()
  const path = pathSegments.join('/')
  return `${base}/${path}${search}`
}

async function proxy(request: NextRequest, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
  try {
    const segments = request.nextUrl.pathname
      .split('/')
      .filter(Boolean)
      .slice(3) // strip /api/facenet-proxy

    if (segments.length === 0) {
      return NextResponse.json({ error: 'Missing target path' }, { status: 400 })
    }

    const targetUrl = buildTargetUrl(segments, request.nextUrl.search)

    const outgoingHeaders = new Headers()
    const contentType = request.headers.get('content-type')
    if (contentType) outgoingHeaders.set('content-type', contentType)

    const init: RequestInit = {
      method,
      headers: outgoingHeaders,
      cache: 'no-store',
    }

    if (method !== 'GET' && method !== 'DELETE') {
      init.body = await request.text()
    }

    const upstream = await fetch(targetUrl, init)
    const bodyText = await upstream.text()

    const responseHeaders = new Headers()
    const upstreamType = upstream.headers.get('content-type')
    if (upstreamType) responseHeaders.set('content-type', upstreamType)
    responseHeaders.set('cache-control', 'no-store')

    return new NextResponse(bodyText, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'FaceNet proxy request failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 502 }
    )
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET')
}

export async function POST(request: NextRequest) {
  return proxy(request, 'POST')
}

export async function PUT(request: NextRequest) {
  return proxy(request, 'PUT')
}

export async function PATCH(request: NextRequest) {
  return proxy(request, 'PATCH')
}

export async function DELETE(request: NextRequest) {
  return proxy(request, 'DELETE')
}
