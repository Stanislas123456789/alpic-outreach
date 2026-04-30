import { useState, useMemo } from 'react';
import { INDUSTRY_COLORS, STATUS_COLORS } from '../ui/constants';
import { SkeletonTable } from '../ui/Skeleton';
import type { Contact } from '../../types';

const PAGE_SIZES = [25, 50, 100] as const;

interface Props {
  contacts: Contact[];
  loading: boolean;
}

export default function PipelineTab({ contacts, loading }: Props) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [sortCol, setSortCol] = useState('sentAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterName, setFilterName] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterCountry, setFilterCountry] = useState('all');
  const [filterAssignedTo, setFilterAssignedTo] = useState('all');
  const [filterLinkedIn, setFilterLinkedIn] = useState<'all' | 'yes' | 'no'>('all');
  const [filterOpens, setFilterOpens] = useState<'all' | 'yes'>('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);

  const allStatuses = ['all', 'pending', 'sent', 'opened', 'replied', 'bounced', 'invalid'];
  const allIndustries = useMemo(() => ['all', ...Array.from(new Set(contacts.map(c => c.industry).filter(Boolean))).sort()], [contacts]);
  const allCountries = useMemo(() => ['all', ...Array.from(new Set(contacts.map(c => c.country).filter(Boolean))).sort()], [contacts]);
  const allReps = useMemo(() => ['all', ...Array.from(new Set(contacts.map(c => c.assignedTo?.split('@')[0]).filter(Boolean))).sort() as string[]], [contacts]);

  const filtered = useMemo(() => contacts.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (industryFilter !== 'all' && c.industry !== industryFilter) return false;
    if (filterName && !c.firstName.toLowerCase().includes(filterName.toLowerCase())) return false;
    if (filterCompany && !c.company.toLowerCase().includes(filterCompany.toLowerCase())) return false;
    if (filterCountry !== 'all' && c.country !== filterCountry) return false;
    if (filterAssignedTo !== 'all' && (c.assignedTo?.split('@')[0] || '') !== filterAssignedTo) return false;
    if (filterLinkedIn === 'yes' && !c.linkedIn) return false;
    if (filterLinkedIn === 'no' && c.linkedIn) return false;
    if (filterOpens === 'yes' && c.openCount === 0) return false;
    return true;
  }), [contacts, statusFilter, industryFilter, filterName, filterCompany, filterCountry, filterAssignedTo, filterLinkedIn, filterOpens]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortCol) {
      case 'name': return dir * a.firstName.localeCompare(b.firstName);
      case 'company': return dir * a.company.localeCompare(b.company);
      case 'industry': return dir * (a.industry || '').localeCompare(b.industry || '');
      case 'country': return dir * (a.country || '').localeCompare(b.country || '');
      case 'assignedTo': return dir * (a.assignedTo || '').localeCompare(b.assignedTo || '');
      case 'status': return dir * a.status.localeCompare(b.status);
      case 'opens': return dir * (a.openCount - b.openCount);
      case 'sentAt': {
        const da = a.sentAt ? new Date(a.sentAt).getTime() : 0;
        const db = b.sentAt ? new Date(b.sentAt).getTime() : 0;
        return dir * (da - db);
      }
      default: return 0;
    }
  }), [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const paged = sorted.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const activeFilterCount = [
    statusFilter !== 'all', industryFilter !== 'all',
    !!filterName, !!filterCompany, filterCountry !== 'all',
    filterAssignedTo !== 'all', filterLinkedIn !== 'all', filterOpens !== 'all',
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setStatusFilter('all'); setIndustryFilter('all');
    setFilterName(''); setFilterCompany('');
    setFilterCountry('all'); setFilterAssignedTo('all');
    setFilterLinkedIn('all'); setFilterOpens('all');
    setPage(0);
  };

  const exportCsv = () => {
    const headers = ['Name', 'Email', 'Company', 'Industry', 'Country', 'Assigned', 'Status', 'Touch', 'Opens', 'Sent At'];
    const rows = sorted.map(c => [
      c.firstName,
      c.email,
      c.company,
      c.industry,
      c.country,
      c.assignedTo?.split('@')[0] || '',
      c.status,
      c.touch3SentAt ? 'FU2' : c.touch2SentAt ? 'FU1' : c.sentAt ? 'Initial' : '',
      String(c.openCount),
      c.sentAt || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const pill = (active: boolean, color: string): React.CSSProperties => ({
    padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6, transition: 'all 0.12s',
    border: active ? `1px solid ${color}55` : '1px solid rgba(255,255,255,0.08)',
    background: active ? color + '22' : 'rgba(255,255,255,0.03)',
    color: active ? color : 'var(--text-secondary)',
  });

  const ctrlInput: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text)', fontSize: 11, padding: '5px 10px',
    fontFamily: 'inherit', outline: 'none',
  };
  const ctrlSelect: React.CSSProperties = {
    ...ctrlInput, cursor: 'pointer', appearance: 'none' as const,
    paddingRight: 24, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
  };

  const SortTh = ({ col, label, align }: { col: string; label: string; align?: string }) => (
    <th onClick={() => handleSort(col)} style={{
      background: '#0c0e15', borderBottom: '2px solid var(--border)',
      padding: '11px 13px', textAlign: (align as any) || 'left',
      cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: sortCol === col ? 'var(--text)' : 'var(--text-secondary)',
      }}>
        {label}
        <span style={{ fontSize: 9, opacity: sortCol === col ? 1 : 0.3, color: sortCol === col ? 'var(--accent)' : 'inherit' }}>
          {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </span>
    </th>
  );

  const StaticTh = ({ label }: { label: string }) => (
    <th style={{
      background: '#0c0e15', borderBottom: '2px solid var(--border)',
      padding: '11px 13px', position: 'sticky', top: 0, zIndex: 10,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
        {label}
      </span>
    </th>
  );

  if (loading && contacts.length === 0) {
    return <div className="tab-content"><SkeletonTable rows={10} /></div>;
  }

  return (
    <div className="tab-content">
      {/* Filter bar */}
      <div style={{
        background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '12px 14px', marginBottom: 10,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 9 }}>
          <input type="text" placeholder="Search name..." value={filterName} onChange={e => { setFilterName(e.target.value); setPage(0); }}
            style={{ ...ctrlInput, width: 120, borderColor: filterName ? 'var(--accent)' : 'var(--border)' }} />
          <input type="text" placeholder="Search company..." value={filterCompany} onChange={e => { setFilterCompany(e.target.value); setPage(0); }}
            style={{ ...ctrlInput, width: 150, borderColor: filterCompany ? 'var(--accent)' : 'var(--border)' }} />
          <select value={filterCountry} onChange={e => { setFilterCountry(e.target.value); setPage(0); }}
            style={{ ...ctrlSelect, width: 120, borderColor: filterCountry !== 'all' ? 'var(--accent)' : 'var(--border)', color: filterCountry !== 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>
            <option value="all">All countries</option>
            {allCountries.filter(c => c !== 'all').map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={industryFilter} onChange={e => { setIndustryFilter(e.target.value); setPage(0); }}
            style={{ ...ctrlSelect, width: 140, borderColor: industryFilter !== 'all' ? 'var(--accent)' : 'var(--border)', color: industryFilter !== 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>
            <option value="all">All industries</option>
            {allIndustries.filter(i => i !== 'all').map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={filterAssignedTo} onChange={e => { setFilterAssignedTo(e.target.value); setPage(0); }}
            style={{ ...ctrlSelect, width: 130, borderColor: filterAssignedTo !== 'all' ? 'var(--accent)' : 'var(--border)', color: filterAssignedTo !== 'all' ? 'var(--accent)' : 'var(--text-secondary)' }}>
            <option value="all">All reps</option>
            {allReps.filter(r => r !== 'all').map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginLeft: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', marginRight: 2 }}>LI</span>
            {(['all', 'yes', 'no'] as const).map(v => (
              <button key={v} onClick={() => { setFilterLinkedIn(v); setPage(0); }} style={pill(filterLinkedIn === v, '#0a66c2')}>
                {v === 'all' ? 'ALL' : v === 'yes' ? 'HAS' : 'NONE'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', marginRight: 2 }}>OPENS</span>
            {(['all', 'yes'] as const).map(v => (
              <button key={v} onClick={() => { setFilterOpens(v); setPage(0); }} style={pill(filterOpens === v, '#a78bfa')}>
                {v === 'all' ? 'ALL' : 'HAS'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', marginRight: 4 }}>STATUS</span>
          {allStatuses.map(s => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(0); }} style={pill(statusFilter === s, STATUS_COLORS[s] || 'var(--accent)')}>
              {s === 'all' ? 'ALL' : s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Results bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text)' }}>{sorted.length.toLocaleString()}</strong>
          <span> of {contacts.length.toLocaleString()} contacts</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={exportCsv} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 5,
            color: 'var(--text-secondary)', fontSize: 11, padding: '3px 10px',
            cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            CSV Export
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearAllFilters} style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 5,
              color: 'var(--text-secondary)', fontSize: 11, padding: '3px 10px',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="chart-card full" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 400px)' }}>
          <table className="pipeline-table" style={{ tableLayout: 'fixed', minWidth: 960, width: '100%' }}>
            <colgroup>
              <col style={{ width: 120 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 76 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 105 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 100 }} />
            </colgroup>
            <thead>
              <tr>
                <SortTh col="name" label="Name" />
                <SortTh col="company" label="Company" />
                <SortTh col="industry" label="Industry" />
                <SortTh col="country" label="Country" align="center" />
                <SortTh col="assignedTo" label="Assigned" />
                <SortTh col="status" label="Status" />
                <StaticTh label="Touch" />
                <StaticTh label="LinkedIn" />
                <SortTh col="opens" label="Opens" align="center" />
                <SortTh col="sentAt" label="Sent At" />
              </tr>
            </thead>
            <tbody>
              {paged.map((c, idx) => (
                <tr key={c.id + idx}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: idx % 2 === 1 ? 'rgba(255,255,255,0.012)' : undefined,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.07)')}
                  onMouseLeave={e => (e.currentTarget.style.background = idx % 2 === 1 ? 'rgba(255,255,255,0.012)' : '')}
                >
                  <td style={{ padding: '8px 13px', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                    {c.firstName}
                  </td>
                  <td style={{ padding: '8px 13px', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.company}>
                    {c.company}
                  </td>
                  <td style={{ padding: '8px 13px' }}>
                    {c.industry ? (
                      <span style={{
                        background: (INDUSTRY_COLORS[c.industry] || '#6366f1') + '20',
                        color: INDUSTRY_COLORS[c.industry] || '#6366f1',
                        fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                        whiteSpace: 'nowrap', display: 'inline-block',
                      }}>
                        {c.industry}
                      </span>
                    ) : <span style={{ color: 'var(--border)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 13px', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                    {c.country || '—'}
                  </td>
                  <td style={{ padding: '8px 13px', fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.assignedTo ? c.assignedTo.split('@')[0] : '—'}
                  </td>
                  <td style={{ padding: '8px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span
                        className="status-pill"
                        title={c.bounceReason || undefined}
                        style={{
                          background: (STATUS_COLORS[c.status] || '#64748b') + '22',
                          color: STATUS_COLORS[c.status] || '#64748b',
                          border: `1px solid ${(STATUS_COLORS[c.status] || '#64748b')}44`,
                          fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700,
                          whiteSpace: 'nowrap', textTransform: 'capitalize',
                          cursor: c.bounceReason ? 'help' : undefined,
                        }}
                      >
                        {c.status}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '8px 13px' }}>
                    {(() => {
                      const touch = c.touch3SentAt ? 'FU2' : c.touch2SentAt ? 'FU1' : c.sentAt ? 'Initial' : '—';
                      const touchColor = touch === 'FU2' ? '#f59e0b' : touch === 'FU1' ? '#a78bfa' : touch === 'Initial' ? '#6366f1' : 'var(--border)';
                      return touch !== '—' ? (
                        <span style={{
                          background: touchColor + '20', color: touchColor,
                          fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                          whiteSpace: 'nowrap', display: 'inline-block',
                        }}>
                          {touch}
                        </span>
                      ) : <span style={{ color: 'var(--border)' }}>—</span>;
                    })()}
                  </td>
                  <td style={{ padding: '8px 13px' }}>
                    {c.linkedIn ? (
                      <a href={c.linkedIn} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#0a66c2', fontSize: 11, fontWeight: 600, textDecoration: 'none', background: '#0a66c211', border: '1px solid #0a66c222', borderRadius: 4, padding: '2px 7px' }}
                        title={c.linkedIn}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="#0a66c2">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                        View
                      </a>
                    ) : (
                      <span style={{ color: 'var(--border)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 13px', textAlign: 'center' }}>
                    {c.openCount > 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#a78bfa', fontFamily: "'DM Mono', monospace", fontSize: 11, background: '#a78bfa11', border: '1px solid #a78bfa22', borderRadius: 4, padding: '2px 7px' }}>
                        {c.openCount}
                      </span>
                    ) : <span style={{ color: 'var(--border)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 13px', fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatDate(c.sentAt || '')}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '64px 32px' }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>No contacts match</div>
                    <div style={{ fontSize: 11 }}>Try adjusting your filters</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {sorted.length > 0 && (
          <div style={{
            padding: '10px 16px', borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>Rows per page:</span>
              {PAGE_SIZES.map(size => (
                <button
                  key={size}
                  onClick={() => { setPageSize(size); setPage(0); }}
                  style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    border: 'none', cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                    background: pageSize === size ? 'var(--accent)' : 'var(--border-subtle)',
                    color: pageSize === size ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'DM Mono', monospace" }}>
              <span>{clampedPage * pageSize + 1}–{Math.min((clampedPage + 1) * pageSize, sorted.length)} of {sorted.length.toLocaleString()}</span>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                style={{
                  padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'none', color: clampedPage === 0 ? 'var(--text-muted)' : 'var(--text)',
                  cursor: clampedPage === 0 ? 'not-allowed' : 'pointer', fontSize: 12,
                }}
              >
                Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={clampedPage >= totalPages - 1}
                style={{
                  padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)',
                  background: 'none', color: clampedPage >= totalPages - 1 ? 'var(--text-muted)' : 'var(--text)',
                  cursor: clampedPage >= totalPages - 1 ? 'not-allowed' : 'pointer', fontSize: 12,
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
