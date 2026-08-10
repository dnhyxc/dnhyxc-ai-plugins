import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export default function App() {
	return (
		<div className="h-full w-full bg-theme-background">
			<Toaster />
			<RouterProvider router={router} />
		</div>
	);
	// return <RouterProvider router={router} />;
}
