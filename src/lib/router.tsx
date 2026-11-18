import { useSyncExternalStore } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function Link({
  to,
  children,
  ...props
}: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a href={`#${to}`} {...props}>
      {children}
    </a>
  );
}