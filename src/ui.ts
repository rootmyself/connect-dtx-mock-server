// 4개 로컬 화면(/phicode·/phicodes·/organizations·/dtxresult) 공통 상단 메뉴.
// active는 현재 경로. 서버 값은 텍스트뿐이라 innerHTML 고정 문자열만 쓴다.
const NAV_ITEMS = [
  { href: "/phicode", label: "발급" },
  { href: "/phicodes", label: "발급 목록" },
  { href: "/organizations", label: "병원 목록" },
  { href: "/dtxresult", label: "수신 확인" },
] as const;

export const NAV_CSS = `nav.menu{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
nav.menu a{color:#fff;text-decoration:none;font-size:13px;padding:6px 12px;border:1px solid rgba(255,255,255,.45);border-radius:999px}
nav.menu a.active{background:#fff;color:#0f2851;border-color:#fff}
nav.menu a:focus-visible{outline:2px solid #0e9f8a;outline-offset:2px}`;

export function navHtml(active: string): string {
  const links = NAV_ITEMS.map((item) =>
    item.href === active
      ? `<a href="${item.href}" class="active" aria-current="page">${item.label}</a>`
      : `<a href="${item.href}">${item.label}</a>`,
  ).join("");
  return `<nav class="menu" aria-label="mock 메뉴">${links}</nav>`;
}
