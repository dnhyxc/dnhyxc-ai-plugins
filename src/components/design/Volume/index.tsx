import { Volume1, Volume2, VolumeX } from 'lucide-react';

const Volume = ({ volume, size = 18 }: { volume: number; size?: number }) => {
	if (volume <= 0) return <VolumeX size={size} />;
	if (volume < 0.6) return <Volume1 size={size} />;
	return <Volume2 size={size} />;
};

export default Volume;
