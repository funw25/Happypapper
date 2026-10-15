"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/settings/profile", label: "个人资料" },
  { href: "/settings/account", label: "账号安全" },
  { href: "/settings/privacy", label: "隐私设置" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="hp-settings-nav" aria-label="设置">
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} data-active={pathname === item.href}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
