/** 与规划文档 §9.4 一致。输入是词库导出 JSON，输出才是可导入文件。 */
export const IMPORT_PROMPT = `请为 JSON 文件中的 items 里的每一个 word 写详解。
只输出一个 JSON 对象，不要 Markdown，不要重复输入里的 title、ipa、pos、segmentation、translationZh、example。
顶层是 { "items": [ ... ] }。每个 item 只有 word 和 detail。
word 必须原样复制输入里的 word，不要翻译，不要改大小写，不要改空格。
detail 不要写 lemma，不要写音标，不要写音节。
输入里的 pos 若含多个词性（如 adj./n./v.），拆成多条 senses，每条 pos 不超过 32 个字符。
输入里的 translationZh 和 example 只作参考，detail.examples 另写至少 4 条，不要把词库原句原样再贴一次就结束。
detail.morphology.parts：至少 4 段，最多 8 段，每段 form、kind、meaningZh。
kind 只能是 prefix、root、suffix、base。拆不开时只给一段 kind 为 base 的整词，不要编造前后缀。
detail.morphology.storyZh：一两句中文，可以是空字符串。
detail.memory.hookZh：一句中文记忆，必须有。
detail.senses：至少 4 条，最多 6 条，每条 pos、glossZh、nuanceZh。没有差别 nuanceZh 用空字符串。
detail.examples：至少 4 条，最多 6 条，每条 en 和 zh 都要有。
detail.family、collocations、synonyms：可空数组，最多 6 条。
family 和 synonyms 每条是 word、pos、glossZh。
collocations 每条是 phrase、glossZh。
detail.tags：可空数组，最多 4 个短标签。
如果一次写不完，只输出已经写完的词，JSON 必须能被完整解析，不要截断在半个对象。
一次输出不要超过 2000 条；超出时分成多个同样形状的文件。
注意：最终必须要以 .json 文件形式或者 markdown 的形式输出，一定不能直接通过文本的形式输出，同时如果可以要优先通过 .json 文件形式输出。`;
