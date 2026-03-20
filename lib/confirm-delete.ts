import Swal from 'sweetalert2'

interface ConfirmDeleteOptions {
  title: string
  html: string
  confirmButtonText?: string
}

export async function confirmDelete({
  title,
  html,
  confirmButtonText = 'Delete',
}: ConfirmDeleteOptions): Promise<boolean> {
  const result = await Swal.fire({
    title,
    html,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText,
    confirmButtonColor: '#dc2626',
    cancelButtonText: 'Cancel',
    reverseButtons: true,
  })

  return result.isConfirmed
}