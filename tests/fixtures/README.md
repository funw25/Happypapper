# 回归测试样本

| 编号 | 文件 | 来源及用途 |
| --- | --- | --- |
| F01 | F01-reading-notes.pdf | 项目自建文本和 PDF 生成器。五页单栏英文，带真实文本层，供上传、读取和选句回归测试。 |

| F06 | F06-rotated.pdf | 项目自建两页 PDF，旋转 90°、使用非默认 CropBox。 |
| F08 | F08-image-only.pdf | 项目自建一页图形 PDF，用于验证无文本页的框选。 |

运行 node tests/fixtures/generate-pdfs.mjs 可复现这些样本。测试账号使用 .test 域，权限验证脚本在独立 PGlite 实例中建立账号和上传样本。
