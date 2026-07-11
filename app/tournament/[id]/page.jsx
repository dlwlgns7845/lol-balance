'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function TournamentIndexRedirect() {
  const { id } = useParams();
  const router = useRouter();
  useEffect(() => { router.replace(`/tournament/${id}/notice`); }, [id, router]);
  return null;
}
