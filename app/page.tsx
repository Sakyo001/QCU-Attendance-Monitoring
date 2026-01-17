import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, UserCheck, GraduationCap, Github } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      {/* Hero Section */}
      <section className="relative w-full py-20 md:py-32 lg:py-40 bg-gradient-to-b from-primary/10 to-background overflow-hidden">
        <div className="container px-4 md:px-6 mx-auto relative z-10 text-center">
            <div className="inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium bg-background/50 backdrop-blur-sm mb-6 text-primary">
                v1.0.0 Released
            </div>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-primary to-violet-600 mb-6 drop-shadow-sm">
            Facial Recognition <br className="hidden md:block"/> Attendance System
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-8 font-light leading-relaxed">
            Secure, automated, and contactless attendance monitoring for the modern educational institution.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="#portals">
                <Button size="lg" className="rounded-full px-8 text-lg h-12 shadow-lg shadow-primary/25">
                 Get Started
                </Button>
            </Link>
            <Button variant="outline" size="lg" className="rounded-full px-8 text-lg h-12 bg-background/50 backdrop-blur-sm">
              <Github className="mr-2 h-5 w-5" />
              View on GitHub
            </Button>
          </div>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] opacity-30 pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/40 to-violet-400/40 rounded-full blur-3xl" />
        </div>
      </section>

      {/* Portals Section */}
      <section id="portals" className="py-20 bg-background relative">
        <div className="container px-4 md:px-6 mx-auto">
            <div className="text-center mb-16">
                <h2 className="text-3xl font-bold tracking-tight mb-4">Select Your Portal</h2>
                <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Access the dashboard relevant to your role. Secure access required.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Registrar / Admin Portal */}
            <Link href="/admin/login" className="block group">
                <Card className="h-full hover:shadow-xl hover:shadow-primary/5 hover:border-primary/50 transition-all duration-300 cursor-pointer overflow-hidden relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="text-center pb-6">
                        <div className="mx-auto bg-primary/10 p-5 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform duration-300">
                        <ShieldCheck className="w-10 h-10 text-primary" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Registrar & Admin</CardTitle>
                        <CardDescription className="text-base">System configuration, section management, and institution-wide analytics.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground font-semibold h-11 rounded-xl">
                            Administrator Login
                        </Button>
                    </CardContent>
                </Card>
            </Link>

            {/* Professor / Adviser Portal */}
            <Link href="/professor/login" className="block group">
                <Card className="h-full hover:shadow-xl hover:shadow-violet-500/5 hover:border-violet-500/50 transition-all duration-300 cursor-pointer overflow-hidden relative">
                     <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="text-center pb-6">
                        <div className="mx-auto bg-violet-100 dark:bg-violet-900/30 p-5 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform duration-300">
                        <GraduationCap className="w-10 h-10 text-violet-600 dark:text-violet-400" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Professor & Adviser</CardTitle>
                        <CardDescription className="text-base">Monitor your assigned sections, mark attendance, and generate reports.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full bg-violet-100 text-violet-700 hover:bg-violet-600 hover:text-white dark:bg-violet-900/30 dark:text-violet-300 font-semibold h-11 rounded-xl">
                            Faculty Login
                        </Button>
                    </CardContent>
                </Card>
            </Link>

            {/* Student Portal */}
            <Link href="/student/login" className="block group">
                <Card className="h-full hover:shadow-xl hover:shadow-emerald-500/5 hover:border-emerald-500/50 transition-all duration-300 cursor-pointer overflow-hidden relative">
                     <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <CardHeader className="text-center pb-6">
                        <div className="mx-auto bg-emerald-100 dark:bg-emerald-900/30 p-5 rounded-2xl w-fit mb-6 group-hover:scale-110 transition-transform duration-300">
                        <UserCheck className="w-10 h-10 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <CardTitle className="text-2xl mb-2">Student Portal</CardTitle>
                        <CardDescription className="text-base">Mark your daily attendance, view past records, and manage your profile.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button className="w-full bg-emerald-100 text-emerald-700 hover:bg-emerald-600 hover:text-white dark:bg-emerald-900/30 dark:text-emerald-300 font-semibold h-11 rounded-xl">
                            Student Login
                        </Button>
                    </CardContent>
                </Card>
            </Link>
            </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t bg-muted/30">
        <div className="container px-4 md:px-6 mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
             <p className="text-sm text-muted-foreground">
                &copy; 2026 EduScan Attendance System. All rights reserved.
            </p>
            <div className="flex gap-4 text-sm text-muted-foreground">
                <Link href="#" className="hover:text-primary transition-colors">Privacy Policy</Link>
                <Link href="#" className="hover:text-primary transition-colors">Terms of Service</Link>
                <Link href="#" className="hover:text-primary transition-colors">Contact Support</Link>
            </div>
        </div>
      </footer>
    </div>
  );
}
