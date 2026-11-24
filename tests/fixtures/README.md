# 回归测试样本

| 编号 | 文件 | 来源及用途 |
| --- | --- | --- |
| F01 | F01-reading-notes.pdf | 项目自建文本和 PDF 生成器。五页单栏英文，带真实文本层，供上传、读取和选句回归测试。 |

运行 node tests/fixtures/generate-pdfs.mjs 可复现 F01。测试账号使用 .test 域，权限验证脚本在独立 PGlite 实例中建立账号和上传样本。
