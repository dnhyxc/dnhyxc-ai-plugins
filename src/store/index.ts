import { createContext, useContext } from 'react';
import LearningNotesStore from './learningNotes';

class RootStore {
	learningNotesStore = LearningNotesStore;
}

const store = new RootStore();

const Context = createContext(store);

export default function useStore() {
	return useContext(Context);
}

export { LearningNotesStore };
