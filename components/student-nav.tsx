"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, Calendar, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function StudentNav() {
  const pathname = usePathname();

  const links = [
    { href: "/student", label: "Attend", icon: Camera },
    { href: "/student/history", label: "History", icon: Calendar },
    { href: "/student/profile", label: "Profile", icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 lg:hidden">
      <div className="flex justify-around items-center h-16">
        {links.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
          <Link
            key={href}
            href={href}
            className={cn(
                "flex flex-col items-center justify-center w-full h-full space-y-1 text-xs font-medium transition-colors",
                isActive ? "text-slate-900" : "text-slate-500 hover:text-slate-900"
            )}
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        )})}
      </div>
    </div>
  );
}

export function StudentHeader() {
    return (
        <header className="bg-white border-b border-slate-200 py-4 px-6 fixed top-0 w-full z-10 flex justify-between items-center">
             <h1 className="text-lg font-semibold">Attendance App</h1>
             <div className="text-sm font-medium text-slate-500">Welcome, Alice</div>
        </header>
    )
}
