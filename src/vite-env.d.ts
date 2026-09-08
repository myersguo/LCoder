/// <reference types="vite/client" />

interface MonacoEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

interface Window {
  MonacoEnvironment?: MonacoEnvironment;
}

declare const MonacoEnvironment: MonacoEnvironment | undefined;
