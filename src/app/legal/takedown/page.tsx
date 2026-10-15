import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "侵权投诉 · HappyPaper" };

export default function TakedownPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10 text-sm leading-7">
        <h1 className="text-xl font-semibold">侵权投诉与下架</h1>
        <p className="mt-3 text-[var(--paper-muted)]">
          HappyPaper 只索引公开元数据（arXiv、Crossref / OpenAlex）。可以缓存的 PDF 限于明确开放获取的来源；用户上传的
          PDF 默认仅上传者可见，转为公开需要上传者声明拥有分发权利。
        </p>

        <h2 className="mt-8 text-base font-semibold">提交投诉</h2>
        <p className="mt-2">请发送邮件到下面地址，并在邮件中包含所需材料：</p>
        <p className="mt-2">
          <a className="text-[var(--paper-accent)] hover:underline" href="mailto:takedown@happypaper.local">
            takedown@happypaper.local
          </a>
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-6">
          <li>涉事论文在 HappyPaper 上的链接（<code>/papers/&lt;id&gt;</code>）。</li>
          <li>你的权利证明，或你所代理的权利人授权说明。</li>
          <li>你认为构成侵权的具体内容与理由。</li>
          <li>你的联系方式，以及一份声明，确认所提供信息真实且你被授权提出该投诉。</li>
        </ol>

        <h2 className="mt-8 text-base font-semibold">处理流程与时限</h2>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--paper-line)] text-left text-[var(--paper-muted)]">
              <th className="py-2">阶段</th>
              <th className="py-2">时限</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--paper-line)]">
              <td className="py-2">确认收到投诉</td>
              <td className="py-2">2 个工作日</td>
            </tr>
            <tr className="border-b border-[var(--paper-line)]">
              <td className="py-2">先行下架争议 PDF，转为不可读</td>
              <td className="py-2">收到完整材料后 24 小时</td>
            </tr>
            <tr className="border-b border-[var(--paper-line)]">
              <td className="py-2">给出处理结论（维持下架 / 恢复）</td>
              <td className="py-2">7 个工作日</td>
            </tr>
          </tbody>
        </table>

        <h2 className="mt-8 text-base font-semibold">管理员操作</h2>
        <p className="mt-2">
          管理员可以在
          <Link href="/admin?tab=papers" className="mx-1 text-[var(--paper-accent)] hover:underline">
            后台的论文页
          </Link>
          把论文转为私有并删除本站缓存的 PDF 文件。
        </p>

        <p className="mt-8 text-[var(--paper-muted)]">
          举报单条评论请使用阅读器侧栏评论上的「举报」按钮，管理员在
          <Link href="/admin" className="mx-1 text-[var(--paper-accent)] hover:underline">
            管理后台
          </Link>
          处理。
        </p>
      </main>
    </>
  );
}
