import { cn } from '@/lib/utils';

const Segmented = <T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: { label: string; value: T }[];
	onChange: (v: T) => void;
}) => {
	return (
		<div className="flex w-full overflow-hidden rounded text-textcolor">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					className={cn(
						'flex-1 border-r border-theme/15 last:border-r-0 cursor-pointer px-2 py-1 text-center text-sm transition-colors bg-teal-500/20 text-textcolor hover:bg-teal-300 hover:text-white',
						value === o.value && 'bg-teal-500 text-white',
					)}
					onClick={() => onChange(o.value)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
};

export default Segmented;
