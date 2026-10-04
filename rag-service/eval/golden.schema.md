# golden set 格式说明

评测集：人工校验过的「问题 → 参考答案 → 依据片段」三元组，供检索侧（Python）与答案侧（Node/TS）共用。

- **文件**：[`golden.jsonl`](./golden.jsonl)（本文件只描述格式，数据在 jsonl 里）
- **格式**：JSONL —— 一行一条 JSON 对象，UTF-8 无 BOM，行尾 `\n`
- **写入方式**：只能**追加**新行，不重排、不改动已有行。JSONL 无注释语法，因此本说明单独成文

## 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | `string` | ✅ | 稳定标识，形如 `diet-001` / `strength-014`。**只增不改**，删条目后不复用旧 id，避免报告对不上 |
| `question` | `string` | ✅ | 用户口吻的自然问句。不要写成 `chunk-42 讲了什么` —— 那样测的是关键词匹配不是语义检索 |
| `reference_answer` | `string` | ✅ | 参考答案。判分与人工复核的基准。可含数字与单位，长度 1–3 句为宜 |
| `gold_chunk_ids` | `number[]` | ✅ | 能支撑该答案的 `chunks.id`。**按相关性从高到低排列**（`MRR` 依赖顺序） |
| `category` | `string` | ✅ | 题型分桶，见下表 |
| `difficulty` | `string` | ✅ | `easy` \| `medium` \| `hard`，用于看指标是否随难度退化 |

### `category` 取值

| 值 | 含义 | 对指标的额外价值 |
|---|---|---|
| `factual` | 单点事实（某动作练哪块肌肉） | 基线 |
| `numeric` | 数值/剂量（蛋白质摄入量、组间休息秒数） | 数字密集，最能暴露切块把表格切碎的问题 |
| `procedural` | 怎么做（动作要领、步骤） | 答案长，测生成侧完整性 |
| `comparative` | 对比/取舍（有氧 vs 力量、减脂期蛋白高低） | 常需多个片段，测多路召回 |
| `multi_hop` | 必须跨两个以上片段才能答 | `gold_chunk_ids` 会有多元素，`recall@k` 的分母是「全部命中」还是「命中其一」需在脚本里明确 |
| `unanswerable` | 语料未覆盖，正确行为是如实说不知道 | **`gold_chunk_ids` 为空数组**。不参与 recall，只用于采 LLM-as-judge 的忠实度 |

`source`（语料来自哪份文档）**不单独存字段** —— 由 `gold_chunk_ids` 反查 `chunks.source` 得到，避免同一事实存两份而漂移。

## 示例

```jsonl
{"id":"diet-001","question":"减脂期每天蛋白质吃多少合适？","reference_answer":"文档建议力量训练者从每天每磅体重 1 克蛋白质起步。","gold_chunk_ids":[412,413],"category":"numeric","difficulty":"easy"}
{"id":"strength-007","question":"新手练背，一周安排几次比较合理？","reference_answer":"文档建议新手每周 2–3 次，两次之间至少间隔 48 小时。","gold_chunk_ids":[1102],"category":"procedural","difficulty":"medium"}
{"id":"diet-088","question":"生酮饮食适合增肌吗？","reference_answer":"检索到的文档未涉及生酮饮食，应如实说明无法回答。","gold_chunk_ids":[],"category":"unanswerable","difficulty":"hard"}
```

> 示例中的 id 为示意，实际写入前需用下面的命令核对。

## ⚠️ `gold_chunk_ids` 与 vectors.db 版本绑定

`chunks.id` 是 `ingest.py` 每次重建表（`DROP TABLE` + `AUTOINCREMENT`）时重新分配的，**不跨版本稳定**。当前版本（1024 维 bge-m3，`CHUNK_SIZE=400` / `OVERLAP=50` / `MIN_CHUNK=120`）的 id 分布：

| source | id 区间 | 片段数 | 长度中位数 |
|---|---|---|---|
| `dietary_guide` | 1 – 932 | 932 | 400 |
| `力量训练基础` | 933 – 1985 | 1053 | 273 |

只要改动下列任一项，全部 `gold_chunk_ids` 作废，必须重新校对：

1. `ingest.py` 的 `clean()` / `chunk_text()` / `merge_short_paragraphs()`（含 `CHUNK_SIZE`、`OVERLAP`、`MIN_CHUNK`）
2. `data/` 下的 `.txt` 语料内容
3. `os.listdir` 的返回顺序（`ingest.py:52` 未排序，两份语料的 id 段归属可能互换）
4. 换了 embedding 模型

**约束**：改切分策略（如第 4–5 周的语义切分）必须**先冻结**当前 `vectors.db` 副本并用它跑完 baseline，再动 `chunk_text()`。否则 baseline 数字与改造后数字不可比 —— 测的已经不是同一件事。

**备份**：改 `ingest.py` 前先 `cp data/vectors.db data/vectors.v1.db`，golden set 与该副本配套。

## 常用命令

```bash
# 条数与 id 唯一性
python -c "import json;[json.loads(l) for l in open('golden.jsonl',encoding='utf-8')];print('ok')"

# 核对 gold_chunk_ids 真实存在，并看命中的是哪个 source
python -c "
import json, sqlite3
c = sqlite3.connect('file:../data/vectors.db?mode=ro', uri=True)
for line in open('golden.jsonl', encoding='utf-8'):
    r = json.loads(line)
    for cid in r['gold_chunk_ids']:
        row = c.execute('SELECT source FROM chunks WHERE id=?', (cid,)).fetchone()
        if row is None:
            print('MISSING', r['id'], cid)
"

# 逐条查看 gold 片段原文，人工校验用
python -c "
import json, sqlite3
c = sqlite3.connect('file:../data/vectors.db?mode=ro', uri=True)
for line in open('golden.jsonl', encoding='utf-8'):
    r = json.loads(line)
    print('==', r['id'], r['question'])
    for cid in r['gold_chunk_ids']:
        print('  ', cid, c.execute('SELECT text FROM chunks WHERE id=?', (cid,)).fetchone()[0][:120])
"
```

## 相关

- 生成脚本：`build_golden.py` → 产出 `golden.candidates.jsonl`（候选，未校验）
- 本文件对应的是**人工校验后**的最终集，候选不得直接当 golden 用
