import Link from "next/link";
import { Users, LayoutDashboard, FileText, Settings, LogOut, BookOpen, GraduationCap } from "lucide-react";

export function AdminSidebar() {
  return (
    <div className="w-64 border-r bg-background flex flex-col min-h-screen">
      <div className="p-6">
        <h2 className="text-xl font-bold tracking-tight text-foreground">Admin Panel</h2>
        <p className="text-xs text-muted-foreground mt-1">Registrar Office</p>
      </div>
      <nav className="flex-1 px-4 space-y-2">
        <Link href="/admin" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <LayoutDashboard className="w-5 h-5" />
          <span>Dashboard</span>
        </Link>
        <Link href="/admin/students" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Users className="w-5 h-5" />
          <span>Students</span>
        </Link>
        <Link href="/admin/sections" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <BookOpen className="w-5 h-5" />
          <span>Sections</span>
        </Link>
         <Link href="/admin/faculty" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <GraduationCap className="w-5 h-5" />
            <span>Faculty</span>
        </Link>
        <Link href="/admin/reports" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <FileText className="w-5 h-5" />
          <span>Reports</span>
        </Link>
        <Link href="/admin/settings" className="flex items-center gap-3 px-4 py-3 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <Settings className="w-5 h-5" />
          <span>Settings</span>
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
