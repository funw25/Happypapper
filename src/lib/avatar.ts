/**
 * 头像由昵称生成：取昵称的前两个字符，底色与字色由用户选择
 * （默认蓝底 #002FA7 + 白字，docs/03-requirements.md 第 5.2 节）。
 *
 * 不做图片上传也不读外链 URL：站点上的头像因此处处一致，不依赖对象存储、不受
 * 外链失效影响，也不需要在页面上区分「谁的头像是什么形态」。这里只有纯函数，
 * 服务端组件与客户端表单都能用。
 */
export const DEFAULT_AVATAR_BG = "#002FA7";
export const DEFAULT_AVATAR_FG = "#FFFFFF";

/** 可选底色：都配白字可读，避免用户选到浅色底 + 白字这种看不见的组合。 */
export const AVATAR_PALETTE: { bg: string; label: string }[] = [
  { bg: "#002FA7", label: "克莱因蓝" },
  { bg: "#1F6F4A", label: "墨绿" },
  { bg: "#7A1F3D", label: "酒红" },
  { bg: "#4B3F72", label: "紫罗兰" },
  { bg: "#8A4B08", label: "赭石" },
  { bg: "#1C1B19", label: "墨黑" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value.trim());
}

/** 归一化为大写，落库与比较都用同一种写法，避免 #ffffff 与 #FFFFFF 被当成不同颜色。 */
export function normaliseHex(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * 头像文字：昵称的前两个字符。用 Array.from 按码点切分，否则 emoji 或罕用汉字会
 * 被从中间劈开；空白先去掉，全空时回落成问号。
 */
export function avatarInitials(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim().replace(/\s+/g, "");
  if (!trimmed) return "?";
  return Array.from(trimmed).slice(0, 2).join("");
}

export type AvatarColors = { bg: string; fg: string };

/** 颜色取值：非法或缺省一律回落默认值，页面不会因为一条脏数据渲染出透明头像。 */
export function avatarColors(row: { avatarBg?: string | null; avatarFg?: string | null }): AvatarColors {
  return {
    bg: isHexColor(row.avatarBg) ? normaliseHex(row.avatarBg as string) : DEFAULT_AVATAR_BG,
    fg: isHexColor(row.avatarFg) ? normaliseHex(row.avatarFg as string) : DEFAULT_AVATAR_FG,
  };
}
