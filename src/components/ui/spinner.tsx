import { Bubbles } from 'lucide-react';

import { cn } from '@/lib/utils';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
	return (
		<Bubbles
			role="status"
			aria-label="Loading"
			className={cn('size-5 pl-px animate-spin text-default', className)}
			{...props}
		/>
	);
}

export { Spinner };
