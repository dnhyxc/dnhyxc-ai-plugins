export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		'type-enum': [
			2,
			'always',
			[
				'feat',
				'bug',
				'fix',
				'ui',
				'docs',
				'style',
				'perf',
				'release',
				'deploy',
				'refactor',
				'test',
				'chore',
				'revert',
				'merge',
				'other',
				'build',
			],
		],
		'type-case': [2, 'always', 'lower-case'],
		'type-empty': [2, 'never'],
		// 关闭全小写限制，允许 feat: 后使用英文大写（如专有名词、API 名）
		'subject-case': [0],
		'subject-empty': [2, 'never'],
		'header-max-length': [0, 'always', 72],
	},
};
