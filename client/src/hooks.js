import { useCallback, useEffect, useState, createContext, useContext } from 'react';
import { get } from './api.js';

export function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { setData(await get(path)); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
