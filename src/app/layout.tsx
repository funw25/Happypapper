import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HappyPaper",
  description: "面向论文阅读的位置化评论与实时弹幕平台",
};

/**
 * Applies the stored theme before the first paint. Inlined rather than imported
 * because a module load would run after the browser has already painted the
 * light palette, which shows as a flash on every navigation in dark mode.
 */
const THEME_INIT_SCRIPT = `(function(){try{
var key='happypaper-theme';
var pref=localStorage.getItem(key);
if(pref!=='light'&&pref!=='dark'&&pref!=='system'){pref='system';}
var dark=pref==='dark'||(pref==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var root=document.documentElement;
root.dataset.theme=dark?'dark':'light';
root.dataset.themePref=pref;
root.style.colorScheme=dark?'dark':'light';
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
