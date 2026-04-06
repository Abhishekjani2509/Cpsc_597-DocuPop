"use client";

import { Toaster as Sonner } from "sonner";
import { toast as sonnerToast } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-white border-gray-200 text-gray-900 shadow-lg",
          title: "text-gray-900 font-medium",
          description: "text-gray-600",
          actionButton: "bg-blue-600 text-white",
          cancelButton: "bg-gray-100 text-gray-600",
          closeButton: "bg-white border-gray-200 text-gray-600 hover:bg-gray-50",
          error: "bg-red-50 border-red-200 text-red-900",
          success: "bg-green-50 border-green-200 text-green-900",
          warning: "bg-yellow-50 border-yellow-200 text-yellow-900",
          info: "bg-blue-50 border-blue-200 text-blue-900",
        },
      }}
      richColors
    />
  );
}

export const toast = {
  success: (message: string, description?: string) => {
    sonnerToast.success(message, { description });
  },
  error: (message: string, description?: string) => {
    sonnerToast.error(message, { description });
  },
  info: (message: string, description?: string) => {
    sonnerToast.info(message, { description });
  },
  warning: (message: string, description?: string) => {
    sonnerToast.warning(message, { description });
  },
  message: (message: string, description?: string) => {
    sonnerToast(message, { description });
  },
  promise: sonnerToast.promise,
  loading: (message: string) => {
    return sonnerToast.loading(message);
  },
  dismiss: (toastId?: string | number) => {
    sonnerToast.dismiss(toastId);
  },
};
