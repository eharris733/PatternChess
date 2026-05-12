import { create } from 'zustand';

interface PgnUploadState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const usePgnUploadStore = create<PgnUploadState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}));
