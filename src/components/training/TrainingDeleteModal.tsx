import { TrashIcon } from '../icons/TrashIcon';
import { useT } from '../../i18n/useT';

/** Confirmation dialog for permanently deleting the current training position. */
export function TrainingDeleteModal({
  deleting,
  deleteError,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  deleteError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('train.panel.delete')}
      onClick={() => !deleting && onCancel()}
    >
      <div
        className="card max-w-md w-full flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 className="heading-lg">{t('deleteModal.title')}</h2>
        </header>
        <p className="text-text-primary text-sm">
          {t('deleteModal.body')}
        </p>
        {deleteError && (
          <div className="bg-incorrect/10 border-2 border-incorrect/50 text-incorrect rounded-none p-3 text-sm">
            {deleteError}
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <button type="button" className="btn-ghost" disabled={deleting} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary bg-incorrect hover:bg-incorrect border-incorrect inline-flex items-center gap-1.5"
            disabled={deleting}
            onClick={onConfirm}
          >
            <TrashIcon className="h-4 w-4" />
            {deleting ? t('deleteModal.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
