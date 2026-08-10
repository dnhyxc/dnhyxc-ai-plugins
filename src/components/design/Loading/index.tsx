import { motion, Variants } from 'framer-motion';
import { FC, useMemo } from 'react';

interface LoadingProps {
	text?: string;
	className?: string;
	/**
	 * 控制加载图标整体大小 (像素)
	 * 默认 75px
	 */
	size?: number;
}

// 动画变体定义
const circleVariants: Variants = {
	spin: (custom: { duration: number; direction: number }) => ({
		rotate: 360 * custom.direction,
		transition: {
			duration: custom.duration,
			ease: 'linear',
			repeat: Infinity,
		},
	}),
};

const Loading: FC<LoadingProps> = ({
	text = '正在奋力加载中...',
	className = '',
	size = 75,
}) => {
	const textArray = text.split('');
	// 核心逻辑：优化尺寸计算，解决中心点太小的问题
	const config = useMemo(() => {
		const scale = size / 80;

		// 1. 圆圈配置：半径和线宽按比例缩放
		const circles = [
			{
				r: 36 * scale,
				strokeWidth: 5 * scale,
				dashArray: `${120 * scale} ${180 * scale}`,
				duration: 2.5,
				direction: 1,
				gradient: 'grad1',
			},
			{
				r: 26 * scale,
				strokeWidth: 4 * scale,
				dashArray: `${90 * scale} ${140 * scale}`,
				duration: 3,
				direction: -1,
				gradient: 'grad2',
			},
			{
				r: 18 * scale,
				strokeWidth: 3 * scale,
				dashArray: `${60 * scale} ${110 * scale}`,
				duration: 1.5,
				direction: 1,
				gradient: 'grad1',
				opacity: 0.6,
			},
		];

		// 2. 中心光点配置：使用 Math.max 保证最小视觉尺寸
		// 原始尺寸：外光晕 20px (1.25rem), 内核 10px (0.625rem)
		// 即使 size 很小，我们也保证光点有一个最小的基础像素值，而不是无限缩小
		const minOuterSize = 8; // 最小 8px
		const minInnerSize = 4; // 最小 4px

		const outerSize = Math.max(minOuterSize, 20 * scale);
		const innerSize = Math.max(minInnerSize, 10 * scale);

		return {
			containerSize: size,
			circles,
			centerGlow: {
				outer: outerSize,
				inner: innerSize,
			},
		};
	}, [size]);

	return (
		<div
			className={`rounded-md supports-[backdrop-filter:blur(0)]:backdrop-blur-[2px] w-full h-full flex flex-col items-center justify-center ${className}`}
		>
			<div className="flex flex-col items-center gap-4">
				{/* 动态容器 */}
				<div
					className="relative"
					style={{ width: config.containerSize, height: config.containerSize }}
				>
					<motion.svg
						className="w-full h-full"
						viewBox="0 0 100 100"
						role="img"
						aria-label="正在奋力加载中..."
						preserveAspectRatio="xMidYMid meet"
					>
						<defs>
							<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
								<feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
								<feMerge>
									<feMergeNode in="coloredBlur" />
									<feMergeNode in="SourceGraphic" />
								</feMerge>
							</filter>
							<linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="0%">
								<stop offset="0%" stopColor="currentColor" stopOpacity="1" />
								<stop offset="100%" stopColor="currentColor" stopOpacity="0" />
							</linearGradient>
							<linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="0%">
								<stop offset="0%" stopColor="currentColor" stopOpacity="0" />
								<stop offset="100%" stopColor="currentColor" stopOpacity="1" />
							</linearGradient>
						</defs>

						{/* 渲染圆圈 */}
						{config.circles.map((circle, index) => (
							<motion.circle
								key={index}
								cx="50"
								cy="50"
								r={circle.r}
								fill="none"
								stroke={`url(#${circle.gradient})`}
								strokeWidth={circle.strokeWidth}
								strokeLinecap="round"
								strokeDasharray={circle.dashArray}
								strokeOpacity={circle.opacity || 1}
								filter="url(#glow)"
								style={{ transformOrigin: 'center' }}
								variants={circleVariants}
								animate="spin"
								custom={{
									duration: circle.duration,
									direction: circle.direction,
								}}
							/>
						))}
					</motion.svg>

					{/* 中心光点 - 应用优化后的尺寸 */}
					<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
						<motion.div
							className="bg-current rounded-full opacity-20 blur-sm"
							style={{
								width: config.centerGlow.outer,
								height: config.centerGlow.outer,
							}}
							animate={{
								scale: [1, 0.9, 1],
								opacity: [0.2, 0.4, 0.2],
							}}
							transition={{
								duration: 1.5,
								repeat: Infinity,
								ease: 'easeInOut',
							}}
						/>
						<motion.div
							className="absolute bg-current rounded-full opacity-80"
							style={{
								width: config.centerGlow.inner,
								height: config.centerGlow.inner,
							}}
							animate={{
								scale: [1, 1.2, 1],
								opacity: [0.8, 0.4, 0.8],
							}}
							transition={{
								duration: 1.5,
								repeat: Infinity,
								ease: 'easeInOut',
							}}
						/>
					</div>
				</div>

				{/* 文字波浪动画 */}
				<div className="flex justify-center text-textcolor text-md font-medium tracking-wider">
					{textArray.map((char, index) => (
						<motion.span
							key={index}
							className="inline-block" // 确保 transform 生效
							animate={{
								y: [0, -8, 0], // 增大浮动幅度
								scale: [1, 1.1, 1], // 弹性缩放
								opacity: [0.6, 1, 0.6], // 呼吸透明度
							}}
							transition={{
								duration: 1.5,
								ease: 'easeInOut',
								repeat: Infinity,
								delay: index * 0.08,
							}}
							// 新增：文字拖尾/发光效果
							style={{
								filter: `drop-shadow(0 0 1px currentColor)`,
							}}
						>
							{char === ' ' ? '\u00A0' : char}
						</motion.span>
					))}
				</div>
			</div>
		</div>
	);
};

export default Loading;
