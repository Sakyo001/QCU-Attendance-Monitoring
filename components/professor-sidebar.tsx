import Link from "next/link";
import { Users, LayoutDashboard, FileText, Settings, LogOut, BookOpen } from "lucide-react";

export function ProfessorSidebar() {
  return (
    <div className="w-64 border-r bg-background flex flex-col min-h-screen">
      <div className="p-6">
        <h2 className="text-xl font-bold tracking-tight text-foreground">Faculty Portal</h2>
        <p className="text-xs text-muted-foreground mt-1">Prof. John Doe</p>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        <Link href="/professor" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <LayoutDashboard className="w-5 h-5" />
          <span>Dashboard</span>
        </Link>
        <Link href="/professor/sections" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <BookOpen className="w-5 h-5" />
          <span>My Sections</span>
        </Link>
        <Link href="/professor/reports" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <FileText className="w-5 h-5" />
          <span>Attendance Reports</span>
        </Link>
        <Link href="/professor/profile" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Users className="w-5 h-5" />
          <span>Profile</span>
        </Link>
      </nav>
      <div className="p-4 border-t">
        <Link href="/" className="flex items-center gap-3 px-4 py-3 rounded-md text-destructive hover:bg-destructive/10 transition-colors">
            <LogOut className="w-5 h-5" />
            <span>Logout</span>
        </Link>
      </div>
    </div>
  );
}
