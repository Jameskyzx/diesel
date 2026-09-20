# Historical material review / 历史材料审查摘要

Observed: 2026-09-12. **Human review summary; not redistribution approval.**

Subject: fixed historical commit `6be02895643a3fdf8dcee1a5876c5f3d70d03036`,
50 commits / 42 non-merge commits. See the [development-history boundary](../DEVELOPMENT_HISTORY.md).
This note preserves bounded local review findings. It is not an authenticated
upstream snapshot, a fresh secret scan, a complete rights inventory, or evidence
that the archived application runs. Including this document in the release
evidence path inventory binds its published bytes; it does not approve its subject
for redistribution or turn human observations into machine-verified rights.

## Scope and material identities

The earlier all-tree inventory recorded 236 paths / 627 unique blobs, with no
retained dependency package bodies, build outputs or native executables. Source
history still contains data, images, generated schema metadata and copied-code
candidates. A bounded attribution scan covered 618 text blobs, excluding six
`.env.example` versions and three binary blobs. No Copyright/SPDX header was found;
absence of a marker does not prove originality.

| Historical material | Fixed-tip blob / observation |
| --- | --- |
| `src/server/db/seed/country-catalog.ts` | `88852640151d3033ccb3062171daf6d4017a4880`; header attributes Natural Earth fields; four historical blobs |
| `src/server/db/seed/acceptance-fixtures.ts` | `5aa88f33c1862b5f39d73c6982753e0960e05ecb`; embedded regulatory facts and sources, not an original-content guarantee |
| `src/server/db/seed/accepted-market-fixtures.ts` | `8e34a037abda79dab300eea73632cbee374e9b07`; nine sources, 16 year-end observations and eight project-calculated YoY observations |
| `src/app/icon.svg` | `3ef2fc6a923dd84e6c18c1eb2b23c2859122b41a`; green W icon, origin and permission unconfirmed |
| Both Apple touch PNG paths | Shared blob `0522ba421468d1b6105d1bba5ddfec343c2bb059`; same unresolved origin |
| Dashboard / offline Demo JPGs | `abbdea0ba8a68fd37a6686d1fc7a5fd26baf2204` / `bc7fb7a4fb10121ed9809bb550a651dc123bcc40`; historical screenshots, not current release captures |

The icons entered in `26116aeb7f66031715038e04b704b5347d222c4e`. The screenshots
entered in `b50dae67bc0ba0990ef00fce8460163e8a3dae33`; contemporaneous README/TASKS
describe project screenshots, but do not independently prove capture provenance
or all depicted rights. Git authors are not substituted for copyright owners.

## Attributed map and component material

Natural Earth's fixed [license](https://github.com/nvkelso/natural-earth-vector/blob/ca96624a56bd078437bca8184e78163e5039ad19/LICENSE.md)
states that its raster/vector map data are public domain and supplies the optional
credit “Made with Natural Earth.” Its scope here includes geometry, indexes and
the country catalog, not every other project asset. The earlier geometry review
found the old V2 Liechtenstein rectangle was project-added, not upstream geometry;
V3 replaced it. Geometry comparisons did not independently compare every catalog
field. Historical omissions and objects remain unchanged.

The historical shadcn configuration, local Button/Drawer, utility code and ADR-028
identify incorporated-component candidates, not just package imports. The
[official MIT text](https://github.com/shadcn-ui/ui/blob/6ea6856f5a1082d4d9c231559b6bc3ee73827493/LICENSE.md)
was inspected at a license commit predating the project and credits shadcn (2023).
That commit is not claimed as the actual component-copy or generator revision.
Exact copy/adaptation provenance remains unconfirmed. This note neither selects
MIT for Diesel nor substitutes for required MIT notice text in an eventual
distribution. The full local license texts are identified below, not vendored here.

## Nine incorporated market sources

The source-key/URL set was compared with the fixed historical fixture, without
revalidating numerical values. Year-end definitions include category combinations
and unit conversions; YoY is calculated by the project. The fixture's August 3
readback timestamp remains historical and is not this policy review's access date
or independent proof of the original data download.

| Source key | Original recorded source |
| --- | --- |
| `chnNbs2024` | [中国统计年鉴 2024 表 16-20 民用汽车拥有量](https://www.stats.gov.cn/sj/ndsj/2024/left.htm) |
| `usaFhwaMv1x2022` | [Highway Statistics 2022 Table MV-1 State Motor-Vehicle Registrations](https://www.fhwa.dot.gov/policyinformation/statistics/2022/mv1.cfm) |
| `usaFhwaMv1x2023` | [Highway Statistics 2023 Table MV-1 State Motor-Vehicle Registrations](https://www.fhwa.dot.gov/policyinformation/statistics/2023/mv1.cfm) |
| `usaFhwaMv10x2022` | [Highway Statistics 2022 Table MV-10 Bus Registrations](https://www.fhwa.dot.gov/policyinformation/statistics/2022/mv10.cfm) |
| `usaFhwaMv10x2023` | [Highway Statistics 2023 Table MV-10 Bus Registrations](https://www.fhwa.dot.gov/policyinformation/statistics/2023/mv10.cfm) |
| `deuEurostatTruck` | [ROAD_EQS_LORROA Goods road vehicle fleet by vehicle and age](https://doi.org/10.2908/ROAD_EQS_LORROA) |
| `deuEurostatBus` | [ROAD_EQS_BUSMOT Buses and coaches by motor energy](https://doi.org/10.2908/ROAD_EQS_BUSMOT) |
| `braSenatran2022` | [Frota Nacional Dezembro 2022 — por UF e tipo de veículo](https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2022) |
| `braSenatran2023` | [Frota Nacional Dezembro 2023 — por UF e tipo de veículo](https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2023) |

- **NBS:** [general terms](https://www.stats.gov.cn/wzgl/202302/t20230217_1912857.html)
  distinguish statistics use from content reproduction, with attribution and
  exceptions. The year's own [book notice](https://www.stats.gov.cn/sj/ndsj/2024/notepyrightch.htm)
  names China Statistics Press and restricts book reproduction without permission;
  its image was visibly inspected after the text reader returned no content.
  Do not treat book images/layout as unrestricted statistics. Conversely, this
  observation does not establish that extracting numerical facts needs permission
  or that the existing numeric fixture is unlawful. Actual incorporated material
  needs a material-specific assessment; the table image and values were not rechecked.
- **FHWA:** the [Ownership clause](https://www.fhwa.dot.gov/disclaim.cfm) permits
  copying/distributing website information, while disclaiming third-party-rights
  warranties. Four table pages identify state submissions, estimates/missing items
  and GSA federal bus data; some other sources are unnamed. No special table-level
  rights notice was found in the inspected HTML. Preserve source and methodology
  qualifications; that is not proof that all underlying materials are rights-free
  or a new requirement to audit every state before using a national statistic.
- **Eurostat:** [statistical reuse authorization](https://ec.europa.eu/eurostat/en/help/copyright-notice)
  with attribution differs from the editorial-content CC BY 4.0 license. The
  policy's default and its individual/third-party exceptions both remain. Modified
  data need disclosure and a Eurostat non-responsibility disclaimer; citations use
  DOI/datacode and actual access date. Identify project combinations/YoY accordingly.
  DOI/SDMX reads failed and browser pages returned shells, so no cell-specific
  exception was verified. This limitation does not invent a permission requirement
  for every German observation or reverse the default authorization.
- **SENATRAN:** the [RENAVAM catalogue](https://dados.transportes.gov.br/dataset/registro-nacional-de-veiculos-automotores-renavam)
  independently labels its license **Other (Public Domain)**, distinct from the
  annual website's CC BY-ND 3.0 footer. The [open-data plan](https://www.gov.br/transportes/pt-br/acesso-a-informacao/dados-abertos/pda-mt-24-26.pdf),
  Quadro 4, printed page 47, connects the prior fleet dataset name to RENAVAM.
  Do not relabel this CC0 or a software license. Annual XLS bytes were not bound to
  CKAN resources and embedded notices/historical licensing were not reconstructed.
  Preserve the source and distinguish project calculations from published metrics.

These are publisher-specific observations, not blanket licensing of all nine
sources. Regulatory-source assessments in the old fixture and `docs/SOURCES.md`
remain dated records; the market-policy review does not revalidate all regulatory
materials or convert candidate research sources into incorporated datasets.

## Selected dependency bodies and native source chain

Six exact npm archives were inspected without installation, extraction into the
project or script execution: axe-core 4.12.1; Lightning CSS 1.32.0 and 1.33.0 and
their Darwin arm64 packages; @img/sharp-libvips-darwin-arm64 1.2.4. Their SHA-512
values matched the historical lock. This establishes content identity, not npm
signature verification, all-platform license coverage or binary reproducibility.

The axe package contains MPL text plus separate MIT/ISC notices. The four
Lightning CSS license members were byte-identical MPL texts; that does not close
all compiled-component rights. The sharp package's README carries a multi-license
table and has no standalone LICENSE/COPYING/NOTICE member. Its build repository's
Apache license applies to packaging scripts, not the whole shared library.
See fixed upstream [axe notices](https://github.com/dequelabs/axe-core/blob/5d002cca1f862a0699d9f1bb7b5a1ec334fa1b22/LICENSE-3RD-PARTY.txt),
[Lightning CSS license](https://github.com/parcel-bundler/lightningcss/blob/1d680fa14e9a089c92dc0929f869d6757ae91c30/LICENSE),
and [sharp notices](https://github.com/lovell/sharp-libvips/blob/20b5e899954907a3039d6e3d4c200aaa0ec52c4c/THIRD-PARTY-NOTICES.md).

Sharp's 28 version keys map to its 29-row table (16 direct names and 12 lib-prefix
matches); the extra libnsgif entry has an embedded source location in
[libvips](https://github.com/libvips/libvips/tree/0c9151a4f416d2f8ae20a755db218f6637050eec/libvips/foreign/libnsgif).
That is not binary-composition proof. Source license texts and later-version
package declarations remain distinct, and compound licenses are not flattened.
Inspection noted mutable build inputs and download paths without explicit checksum
checks, but did not build binaries, fetch all component source archives, or
establish maliciousness or legal compliance. Inspection-only package bodies are
not part of the proposed Git archive. **No native-binary rebuild requirement is added.**

## Local originals and reproducibility limits

Only this summary is retained here. The raw review originals, upstream license
text copies and downloaded inspection archives remain outside the repository;
the following identities locate earlier local observations, not files promised
to exist beside this note. Hashes do not make missing inputs repository-replayable.

| Local original | Bytes | SHA-256 |
| --- | ---: | --- |
| NOTICE-DRAFT.md | 11951 | `99821433a5c3c864be6663284a5cc8a535edd347bc6559dae3379d6b596b5ba5` |
| upstream-natural-earth-LICENSE.md | 4636 | `2631b5b39b6d1acc56de75235109b5af2dbb4b0ac5a127b6f06185977247fd4b` |
| upstream-shadcn-LICENSE.md | 1063 | `1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f` |
| Historical package-body REVIEW.md | 6636 | `3425d80c9c83a9edf1ed4d1d07a27cb103ef0f0480a8a64b4a63702bb9ef36de` |
| NATIVE_SOURCE_REVIEW.md | 7897 | `16da32c6553f3f0ef16563cb971af13642d9d3019a23abdb3cf74010c1bfcaff` |
| MARKET-REUSE-REVIEW.md | 10682 | `82b89f3ededb7bed16c46a8146d111bcb17814446ae7c18184da52b436ef39f2` |

The earlier NOTICE draft preceded the completed nine-source policy inspection;
its unfinished-review wording is preserved as a dated step, not silently promoted
to a current rights conclusion. The completed policy inspection still did not
grant redistribution approval. Neither this note nor the tests authenticate
upstream responses. The older retained scan manifests and their metadata-only
scope are unchanged.

## Existing decisions and blockers remain

- `source-project-license-missing`
- `source-project-notice-missing`
- `source-package-license-field-missing`
- `historical-assets-and-copied-material-review-incomplete`
- `weak-copyleft-and-notice-policy-missing`

The owner must still decide the owned-code license/copyright holder and confirm
icon rights. Copied components, screenshots and actual material-specific notice
obligations remain review items. An approved notice/weak-copyleft policy must
match the actual source-history distribution scope. A future binary/container
distribution cannot inherit source-only clearance. The required secret-scan and
non-deployable historical labeling gates remain; no archive is published by this
record, no historical object is rewritten, and no project LICENSE is selected.

## 中文说明

这是固定历史对象的有限人工审查摘要，不是再分发批准、上游签名、完整版权清单或
当前运行/测试证明。原始材料未随本摘要入库；表内 hash 只标识先前本地原件，不能
把缺失的全文、包体或网页响应变成可从仓库重放的证据。发布证据路径校验只绑定本文件
的提交字节，不把人工结论升级为自动许可；旧审计 schema、扫描报告和五项阻塞均保留。

地图审查包含国家目录而不只是几何；旧 V2 占位矩形不属于上游。shadcn 的许可证版本
不等于实际复制组件的版本，也不是 Diesel 选用 MIT 的决定。图标出处未确认，截图的
同时期说明也不能证明全部画面权利。自有代码许可证与版权主体不得从 Git 作者猜测。

九项市场来源的官方政策核验已经完成，但没有重新核对数值或批准整库发布。国家统计年鉴
书籍限制与数值事实分开；FHWA 的网站信息复用声明不担保第三方权利；Eurostat 默认授权
及例外同时保留，并须区分项目修改、免责声明和真实访问日期；SENATRAN 数据目录许可
不同于网页页脚。换算、类别合计和同比须明确为项目计算，不冒充发布方原始指标。

六个选定依赖包的内容身份、部分许可证正文及原生源码位置已核对，不等于全部依赖或
二进制组成已审完；不得简化复合许可或将脚本的 Apache 许可套到共享库。下载包体不进入
源码历史归档，也不新增重建上游原生二进制的门槛。原有权利确认、NOTICE/弱 copyleft
政策、密钥扫描和非部署归档要求仍然有效；生产状态及历史对象未变。
