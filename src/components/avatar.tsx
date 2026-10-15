import { avatarColors, avatarInitials } from "@/lib/avatar";

/**
 * 全站统一的头像：昵称前两个字符 + 用户选择的底色/字色。
 *
 * 服务端与客户端都能渲染（纯展示、无状态），所以页头、公开主页、设置页预览用的是
 * 同一个组件，不会出现三处各写一套字号与圆角的情况。
 */
export function Avatar({
  name,
  avatarBg,
  avatarFg,
  size = "md",
}: {
  name: string | null | undefined;
  avatarBg?: string | null;
  avatarFg?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const colors = avatarColors({ avatarBg, avatarFg });
  const dimensions =
    size === "sm" ? "h-7 w-7 text-xs" : size === "lg" ? "h-16 w-16 text-xl" : "h-10 w-10 text-sm";

  return (
    <span
      className={`inline-flex ${dimensions} shrink-0 select-none items-center justify-center rounded-full font-medium`}
      style={{ backgroundColor: colors.bg, color: colors.fg }}
      title={name ?? undefined}
      aria-hidden="true"
    >
      {avatarInitials(name)}
    </span>
  );
}
