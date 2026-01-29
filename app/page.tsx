import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, UserCheck, GraduationCap, Github, ArrowRight, Zap, Lock, BarChart3, ChevronRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20 overflow-x-hidden relative">
      
      {/* Dynamic Background */}
      <div className="fixed inset-0 -z-10 bg-background">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
        <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-primary/5 to-transparent" />
        
        {/* Animated Blobs */}
        <div className="absolute top-20 left-1/4 w-72 h-72 bg-purple-500/30 rounded-full blur-[100px] animate-blob filter mix-blend-multiply opacity-70" />
        <div className="absolute top-20 right-1/4 w-72 h-72 bg-blue-500/30 rounded-full blur-[100px] animate-blob animation-delay-2000 filter mix-blend-multiply opacity-70" />
        <div className="absolute -bottom-8 left-1/3 w-72 h-72 bg-pink-500/30 rounded-full blur-[100px] animate-blob animation-delay-4000 filter mix-blend-multiply opacity-70" />
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-50 w-full backdrop-blur-md border-b bg-background/50">
        <div className="container mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <span className="font-bold text-xl tracking-tight">EduScan</span>
          </div>
          <div className="flex items-center gap-4">
             <Link href="https://github.com/your-repo" target="_blank" className="text-muted-foreground hover:text-foreground transition-colors">
              <Github className="w-5 h-5" />
             </Link>
             <Link href="#portals">
               <Button variant="default" size="sm" className="hidden sm:flex rounded-full">
                 Access Portal
               </Button>
             </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative px-4 md:px-6 pt-20 pb-32 md:pt-32 md:pb-48 overflow-visible">
        <div className="container mx-auto max-w-5xl text-center z-10 relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-8 hover:bg-primary/20 transition-colors cursor-default">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            v1.0 System Live
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70">
            Next-Gen Attendance <br />
            <span className="bg-gradient-to-r from-primary via-violet-500 to-blue-500 bg-clip-text text-transparent">
              Facial Recognition
            </span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Experience seamless, contactless attendance monitoring powered by advanced AI. 
            Secure, fast, and reliable tracking for modern educational institutions.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="#portals">
              <Button size="lg" className="rounded-full text-lg h-14 px-8 shadow-xl shadow-primary/20 hover:shadow-primary/40 transition-all hover:scale-105">
                Get Started
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="rounded-full text-lg h-14 px-8 bg-background/50 hover:bg-background/80 backdrop-blur-sm border-2">
              Learn More
            </Button>
          </div>

          {/* Stats Preview */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto text-center divide-x divide-border/50">
            <div className="p-4">
              <div className="text-3xl font-bold text-foreground">99.9%</div>
              <div className="text-sm text-muted-foreground">Accuracy</div>
            </div>
            <div className="p-4">
              <div className="text-3xl font-bold text-foreground">0.5s</div>
              <div className="text-sm text-muted-foreground">Scan Time</div>
            </div>
            <div className="p-4">
              <div className="text-3xl font-bold text-foreground">10k+</div>
              <div className="text-sm text-muted-foreground">Students</div>
            </div>
             <div className="p-4">
              <div className="text-3xl font-bold text-foreground">100%</div>
              <div className="text-sm text-muted-foreground">Secure</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-muted/40 border-y border-border/50 relative overflow-hidden">
        <div className="container mx-auto px-4 md:px-6 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-bold mb-4">Why Choose EduScan?</h2>
            <p className="text-muted-foreground text-lg">Built with privacy and performance at its core.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-background p-8 rounded-2xl shadow-sm border border-border/50 hover:border-primary/50 transition-colors group">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Lightning Fast</h3>
              <p className="text-muted-foreground">
                Process attendance in milliseconds using optimized face detection algorithms. No queues, no delays.
              </p>
            </div>
            <div className="bg-background p-8 rounded-2xl shadow-sm border border-border/50 hover:border-violet-500/50 transition-colors group">
              <div className="w-12 h-12 bg-violet-100 dark:bg-violet-900/30 text-violet-600 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                 <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Enterprise Security</h3>
              <p className="text-muted-foreground">
                Bank-grade encryption for biometric data. Fully compliant with data privacy regulations.
              </p>
            </div>
            <div className="bg-background p-8 rounded-2xl shadow-sm border border-border/50 hover:border-emerald-500/50 transition-colors group">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                 <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Real-time Analytics</h3>
              <p className="text-muted-foreground">
                Generate detailed reports instantly. Track patterns, identify trends, and improve attendance.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Portals Section */}
      <section id="portals" className="py-24 relative">
        <div className="container px-4 md:px-6 mx-auto">
          <div className="flex flex-col items-center justify-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-6">Select Your Portal</h2>
            <p className="text-xl text-muted-foreground max-w-2xl text-center">
              Dedicated dashboards for every role in the institution.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Admin Portal Card */}
            <Link href="/admin/login" className="transform hover:-translate-y-2 transition-all duration-300">
               <div className="group relative bg-background rounded-3xl p-1 h-full shadow-lg hover:shadow-2xl hover:shadow-primary/20 transition-all duration-500">
                 <div className="absolute inset-0 bg-gradient-to-r from-primary to-blue-600 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl -z-10" />
                 <div className="bg-card h-full rounded-[20px] p-8 flex flex-col items-center text-center border overflow-hidden relative">
                    {/* Hover Glow */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500" />
                    
                    <div className="w-20 h-20 bg-primary/5 rounded-full flex items-center justify-center mb-6 group-hover:bg-primary/10 transition-colors">
                      <ShieldCheck className="w-10 h-10 text-primary" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Admin & Registrar</h3>
                    <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
                      System configuration, user management, and institution-wide reporting controls.
                    </p>
                    <div className="mt-auto w-full">
                      <Button className="w-full rounded-full group-hover:bg-primary transition-all duration-300" variant="outline">
                        Access Dashboard 
                        <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </div>
                 </div>
               </div>
            </Link>

            {/* Professor Portal Card */}
            <Link href="/professor/login" className="transform hover:-translate-y-2 transition-all duration-300">
             <div className="group relative bg-background rounded-3xl p-1 h-full shadow-lg hover:shadow-2xl hover:shadow-violet-600/20 transition-all duration-500">
                 <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl -z-10" />
                 <div className="bg-card h-full rounded-[20px] p-8 flex flex-col items-center text-center border overflow-hidden relative">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-violet-600 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500" />
                    
                    <div className="w-20 h-20 bg-violet-50 rounded-full flex items-center justify-center mb-6 group-hover:bg-violet-100 dark:bg-violet-900/20 transition-colors">
                      <GraduationCap className="w-10 h-10 text-violet-600" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Faculty</h3>
                    <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
                      Manage sections, track student attendance, and monitor class performance efficiently.
                    </p>
                    <div className="mt-auto w-full">
                      <Button className="w-full rounded-full group-hover:text-violet-600 group-hover:border-violet-200 transition-all duration-300" variant="outline">
                        Faculty Login
                        <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </div>
                 </div>
               </div>
            </Link>

            {/* Student Portal Card */}
             <Link href="/student/login" className="transform hover:-translate-y-2 transition-all duration-300">
               <div className="group relative bg-background rounded-3xl p-1 h-full shadow-lg hover:shadow-2xl hover:shadow-emerald-600/20 transition-all duration-500">
                 <div className="absolute inset-0 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl -z-10" />
                 <div className="bg-card h-full rounded-[20px] p-8 flex flex-col items-center text-center border overflow-hidden relative">
                     <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-600 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500" />

                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6 group-hover:bg-emerald-100 dark:bg-emerald-900/20 transition-colors">
                      <UserCheck className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">Student</h3>
                    <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
                      View your attendance history, check class schedules, and manage your profile.
                    </p>
                    <div className="mt-auto w-full">
                       <Button className="w-full rounded-full group-hover:text-emerald-600 group-hover:border-emerald-200 transition-all duration-300" variant="outline">
                        Student Login
                        <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                      </Button>
                    </div>
                 </div>
               </div>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t bg-muted/20">
        <div className="container px-4 md:px-6 mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
             <div className="bg-primary/10 p-2 rounded-lg">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-lg">EduScan</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; 2026 EduScan System. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="#" className="hover:text-primary transition-colors">Privacy</Link>
            <Link href="#" className="hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="hover:text-primary transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
