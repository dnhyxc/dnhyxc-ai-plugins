/** 代码块语法高亮：主流语言（中文标签） */
export const CODE_LANGUAGES = [
	{ value: 'javascript', label: 'JavaScript' },
	{ value: 'typescript', label: 'TypeScript' },
	{ value: 'html', label: 'HTML' },
	{ value: 'css', label: 'CSS' },
	{ value: 'less', label: 'Less' },
	{ value: 'scss', label: 'SCSS' },
	{ value: 'rust', label: 'Rust' },
	{ value: 'python', label: 'Python' },
	{ value: 'c', label: 'C' },
	{ value: 'java', label: 'Java' },
	{ value: 'json', label: 'JSON' },
	{ value: 'go', label: 'Go' },
	{ value: 'sql', label: 'SQL' },
	{ value: 'wasm', label: 'Wasm' },
	{ value: 'php', label: 'PHP' },
	{ value: 'ruby', label: 'Ruby' },
	{ value: 'markdown', label: 'Markdown' },
	{ value: 'shell', label: 'Shell' },
	{ value: 'bash', label: 'Bash' },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]['value'];
