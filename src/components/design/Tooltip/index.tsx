import { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui';

function Tip({
	label,
	children,
	container,
}: {
	label: string;
	children: ReactNode;
	container?: HTMLElement | null;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side="top"
				sideOffset={8}
				container={container}
				onClick={(e) => e.stopPropagation()}
			>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

export default Tip;
