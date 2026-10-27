import React, { useState, useEffect, useMemo } from 'react';
import { 
  Printer, ArrowRight, RefreshCw, Calendar, User as UserIcon, Search, 
  ArrowUpDown, ArrowUp, ArrowDown, Share2, FileDown, FileText, CheckCircle2,
  Clock, Shield, Filter, Hash, Database, ChevronRight, ChevronLeft,
  ChevronsRight, ChevronsLeft
} from 'lucide-react';
import { ProviderFactory } from '../data/ProviderFactory';
import { User } from '../types';
import { parseDate } from '../lib/dateUtils';

interface DocumentOutputRecord {
  id: string;
  document_id?: string;
  document_number?: string;
  document_name?: string;
  output_type?: string; // PRINT | PDF | SHARE | Share
  output_datetime?: string | any;
  user_id?: string;
  [key: string]: any;
}

type FilterMode = 'user' | 'date';
type DateOption = 'all' | 'today' | 'week' | 'custom';
type SortField = 'index' | 'document_number' | 'document_name' | 'output_type' | 'output_datetime' | 'user_id' | 'document_id';
type SortOrder = 'asc' | 'desc';

export default function DocumentOutputsManager({
  currentUser,
  onClose
}: {
  currentUser?: User;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<DocumentOutputRecord[]>([]);
  const [usersList, setUsersList] = useState<{ id: string; name: string; username: string; userNumber?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Filter Mode: 'user' is default as requested
  const [filterMode, setFilterMode] = useState<FilterMode>('user');

  // 2. Dropdown state
  const [selectedUser, setSelectedUser] = useState<string>('all');
  const [selectedDateOption, setSelectedDateOption] = useState<DateOption>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // 3. Sorting
  const [sortField, setSortField] = useState<SortField>('output_datetime');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // 4. Pagination state (Mobile-first default of 10 rows per page)
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Load records and users
  const loadData = async () => {
    setLoading(true);
    try {
      const provider = ProviderFactory.getProvider();
      
      // Fetch document_outputs
      const outputsSnap = await provider.getDocs('document_outputs');
      const loadedRecords: DocumentOutputRecord[] = [];
      if (outputsSnap && outputsSnap.docs) {
        outputsSnap.docs.forEach((doc: any) => {
          loadedRecords.push({ id: doc.id, ...doc.data() });
        });
      }
      setRecords(loadedRecords);

      // Fetch users for dropdown
      const usersSnap = await provider.getDocs('users');
      const loadedUsers: { id: string; name: string; username: string; userNumber?: number }[] = [];
      if (usersSnap && usersSnap.docs) {
        usersSnap.docs.forEach((doc: any) => {
          const u = doc.data();
          loadedUsers.push({
            id: doc.id,
            name: u.name || u.username || 'مستخدم',
            username: u.username || '',
            userNumber: u.userNumber
          });
        });
      }
      setUsersList(loadedUsers);
    } catch (err) {
      console.error('Error loading document_outputs data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Format date and time
  const formatDateTime = (raw: any) => {
    if (!raw) return { date: '---', time: '---' };
    try {
      const d = parseDate(raw) || new Date(raw);
      if (isNaN(d.getTime())) return { date: String(raw), time: '' };
      const dateStr = d.toLocaleDateString('ar-YE', { year: 'numeric', month: '2-digit', day: '2-digit' });
      const timeStr = d.toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit', hour12: true });
      return { date: dateStr, time: timeStr, timestamp: d.getTime() };
    } catch (e) {
      return { date: String(raw), time: '', timestamp: 0 };
    }
  };

  // Toggle sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Render sort icon
  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown size={13} className="text-gray-500 opacity-60 inline-block mr-1" />;
    }
    return sortOrder === 'asc' 
      ? <ArrowUp size={13} className="text-purple-400 inline-block mr-1 font-bold" />
      : <ArrowDown size={13} className="text-purple-400 inline-block mr-1 font-bold" />;
  };

  // Resolve user display label
  const getUserDisplayLabel = (userIdRaw?: string) => {
    if (!userIdRaw || userIdRaw === 'System' || userIdRaw === 'unknown') return 'مدير النظام (1)';
    const clean = String(userIdRaw).trim();
    // Check if it matches a userNumber or name or username
    const found = usersList.find(u => 
      String(u.userNumber) === clean || 
      u.name === clean || 
      u.username === clean || 
      u.id === clean
    );
    if (found) {
      return `${found.name} ${found.userNumber ? `(${found.userNumber})` : ''}`.trim();
    }
    return clean;
  };

  // Filter and sort records
  const filteredRecords = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const oneWeekAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);

    let result = records.filter(record => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const num = String(record.document_number || '').toLowerCase();
        const name = String(record.document_name || '').toLowerCase();
        const user = String(record.user_id || '').toLowerCase();
        const docId = String(record.document_id || '').toLowerCase();
        if (!num.includes(q) && !name.includes(q) && !user.includes(q) && !docId.includes(q)) {
          return false;
        }
      }

      // 2. Filter Mode
      if (filterMode === 'user') {
        if (selectedUser !== 'all') {
          const recUser = String(record.user_id || '').trim();
          const targetUser = usersList.find(u => u.id === selectedUser);
          if (targetUser) {
            const matches = 
              recUser === targetUser.name || 
              recUser === targetUser.username || 
              recUser === String(targetUser.userNumber) || 
              recUser === targetUser.id;
            if (!matches) return false;
          } else {
            if (recUser !== selectedUser) return false;
          }
        }
      } else if (filterMode === 'date') {
        const parsed = parseDate(record.output_datetime) || new Date(record.output_datetime);
        const recordTime = !isNaN(parsed.getTime()) ? parsed.getTime() : 0;

        if (selectedDateOption === 'today') {
          if (recordTime < todayStart) return false;
        } else if (selectedDateOption === 'week') {
          if (recordTime < oneWeekAgo) return false;
        } else if (selectedDateOption === 'custom') {
          if (startDate) {
            const s = new Date(startDate).getTime();
            if (recordTime < s) return false;
          }
          if (endDate) {
            const e = new Date(endDate).getTime() + (24 * 60 * 60 * 1000 - 1);
            if (recordTime > e) return false;
          }
        }
      }

      return true;
    });

    // 3. Sorting
    result.sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (sortField) {
        case 'document_number':
          valA = Number(String(a.document_number || '').replace(/\D/g, '')) || 0;
          valB = Number(String(b.document_number || '').replace(/\D/g, '')) || 0;
          break;
        case 'document_name':
          valA = String(a.document_name || '');
          valB = String(b.document_name || '');
          break;
        case 'output_type':
          valA = String(a.output_type || '');
          valB = String(b.output_type || '');
          break;
        case 'user_id':
          valA = getUserDisplayLabel(a.user_id);
          valB = getUserDisplayLabel(b.user_id);
          break;
        case 'document_id':
          valA = String(a.document_id || '');
          valB = String(b.document_id || '');
          break;
        case 'output_datetime':
        default:
          const dateA = parseDate(a.output_datetime) || new Date(a.output_datetime);
          const dateB = parseDate(b.output_datetime) || new Date(b.output_datetime);
          valA = !isNaN(dateA.getTime()) ? dateA.getTime() : 0;
          valB = !isNaN(dateB.getTime()) ? dateB.getTime() : 0;
          break;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [records, searchQuery, filterMode, selectedUser, selectedDateOption, startDate, endDate, sortField, sortOrder, usersList]);

  // Reset page when filters or pageSize change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterMode, selectedUser, selectedDateOption, startDate, endDate, pageSize]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredRecords.length);
  const paginatedRecords = useMemo(() => {
    return filteredRecords.slice(startIndex, endIndex);
  }, [filteredRecords, startIndex, endIndex]);

  // Output badge renderer
  const renderOutputTypeBadge = (rawType?: string) => {
    const t = String(rawType || '').toUpperCase();
    if (t.includes('PRINT')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <Printer size={13} />
          <span>طباعة ورقية</span>
        </span>
      );
    }
    if (t.includes('SHARE')) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Share2 size={13} />
          <span>مشاركة واتساب</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
        <FileDown size={13} />
        <span>تصدير PDF</span>
      </span>
    );
  };

  return (
    <div 
      className="fixed inset-0 z-[120] bg-[#121212] text-white flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden font-cairo" 
      dir="rtl"
    >
      {/* 1. Header Bar */}
      <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-3.5 bg-[#1a1a1a] border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl transition-all cursor-pointer border border-white/10"
            title="رجوع"
          >
            <ArrowRight size={18} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
              <Printer size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-white m-0">إدارة المطبوعات</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {records.length} حركة
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">سجل تدقيق عمليات طباعة وتصدير ومشاركة المستندات</p>
            </div>
          </div>
        </div>

        {/* Refresh and Counts */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="px-2.5 sm:px-3 py-1.5 sm:py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-bold border border-white/10 flex items-center gap-1.5 transition-all cursor-pointer"
            title="تحديث البيانات"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">تحديث</span>
          </button>
        </div>
      </div>

      {/* 2. Filter Controls Box (Compact & Mobile-Optimized) */}
      <div className="p-3 sm:p-4 bg-[#161616] border-b border-white/10 space-y-2.5 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-4">
          
          {/* Mode Selection */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] sm:text-xs font-bold text-gray-400 shrink-0">طريقة العرض:</span>
            
            {/* Box 1: By System User (Default) */}
            <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
              filterMode === 'user' 
                ? 'bg-purple-600/20 text-purple-300 border-purple-500/50 shadow-sm' 
                : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
            }`}>
              <input
                type="radio"
                name="filterMode"
                value="user"
                checked={filterMode === 'user'}
                onChange={() => {
                  setFilterMode('user');
                  setSelectedUser('all');
                }}
                className="hidden"
              />
              <UserIcon size={13} className={filterMode === 'user' ? 'text-purple-400' : 'text-gray-500'} />
              <span>مستخدم النظام</span>
            </label>

            {/* Box 2: By Date */}
            <label className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
              filterMode === 'date' 
                ? 'bg-purple-600/20 text-purple-300 border-purple-500/50 shadow-sm' 
                : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'
            }`}>
              <input
                type="radio"
                name="filterMode"
                value="date"
                checked={filterMode === 'date'}
                onChange={() => {
                  setFilterMode('date');
                  setSelectedDateOption('all');
                }}
                className="hidden"
              />
              <Calendar size={13} className={filterMode === 'date' ? 'text-purple-400' : 'text-gray-500'} />
              <span>التاريخ</span>
            </label>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث برقم المستند، اسمه، المعرف، أو المستخدم..."
              className="w-full pl-3 pr-8 py-1.5 sm:py-2 bg-[#121212] border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-all font-cairo"
            />
          </div>
        </div>

        {/* Dropdown Section based on active Mode */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
          {filterMode === 'user' ? (
            /* User Dropdown */
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-[11px] sm:text-xs font-bold text-gray-400 shrink-0">اختر المستخدم:</span>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="flex-1 sm:w-64 px-2.5 py-1.5 bg-[#121212] border border-white/10 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-purple-500 transition-all cursor-pointer font-cairo"
              >
                <option value="all">الكل (جميع مستخدمي النظام)</option>
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.userNumber ? `(رقم: ${u.userNumber})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Date Dropdown Options: الكل، اليوم، اسبوع، محدد */
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <span className="text-[11px] sm:text-xs font-bold text-gray-400 shrink-0">النطاق الزمني:</span>
                <select
                  value={selectedDateOption}
                  onChange={(e) => setSelectedDateOption(e.target.value as DateOption)}
                  className="px-2.5 py-1.5 bg-[#121212] border border-white/10 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-purple-500 transition-all cursor-pointer font-cairo"
                >
                  <option value="all">الكل (كافة التواريخ)</option>
                  <option value="today">اليوم</option>
                  <option value="week">أسبوع (آخر 7 أيام)</option>
                  <option value="custom">محدد (نطاق مخصص)</option>
                </select>
              </div>

              {/* Custom Date Pickers */}
              {selectedDateOption === 'custom' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400">من:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="px-2 py-1 bg-[#121212] border border-white/10 rounded-xl text-[11px] text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400">إلى:</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="px-2 py-1 bg-[#121212] border border-white/10 rounded-xl text-[11px] text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mr-auto text-[11px] text-gray-400 font-mono">
            المطابق: <span className="text-purple-400 font-bold">{filteredRecords.length}</span> من <span className="text-white font-bold">{records.length}</span>
          </div>
        </div>
      </div>

      {/* 3. Table Content Area with smooth 4-direction scroll */}
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain p-2 sm:p-4 touch-pan-x touch-pan-y">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400 space-y-3">
            <RefreshCw size={28} className="animate-spin text-purple-500" />
            <p className="text-sm font-bold">جاري تحميل سجلات إدارة المطبوعات...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500 space-y-3 bg-[#181818] rounded-2xl border border-white/5 p-8 text-center">
            <Printer size={42} className="text-gray-600 stroke-[1.5]" />
            <h3 className="text-base font-bold text-gray-300">لا توجد سجلات مطابقة</h3>
            <p className="text-xs text-gray-500 max-w-sm">لم يتم العثور على أي حركات طباعة أو تصدير تطابق الفلاتر المحددة حالياً.</p>
          </div>
        ) : (
          <div className="bg-[#181818] rounded-2xl border border-white/5 overflow-hidden shadow-2xl flex flex-col">
            <div className="overflow-x-auto overflow-y-auto max-h-full overscroll-contain touch-pan-x touch-pan-y">
              <table className="w-full text-xs text-right border-collapse min-w-[760px]">
                <thead className="bg-[#222222] text-gray-300 border-b border-white/10 select-none sticky top-0 z-10 font-cairo">
                  <tr>
                    {/* Index */}
                    <th className="py-2.5 px-3 text-center font-bold text-gray-400 w-12 border-l border-white/5">
                      م
                    </th>

                    {/* Document Number Column with Sort */}
                    <th 
                      onClick={() => handleSort('document_number')}
                      className="py-2.5 px-3 font-bold text-white border-l border-white/5 cursor-pointer hover:bg-white/5 transition-colors whitespace-nowrap"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>رقم المستند</span>
                        {renderSortIndicator('document_number')}
                      </div>
                    </th>

                    {/* Document Name Column with Sort */}
                    <th 
                      onClick={() => handleSort('document_name')}
                      className="py-2.5 px-3 font-bold text-white border-l border-white/5 cursor-pointer hover:bg-white/5 transition-colors whitespace-nowrap"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>اسم المستند</span>
                        {renderSortIndicator('document_name')}
                      </div>
                    </th>

                    {/* Output Type Column with Sort */}
                    <th 
                      onClick={() => handleSort('output_type')}
                      className="py-2.5 px-3 font-bold text-white border-l border-white/5 cursor-pointer hover:bg-white/5 transition-colors text-center whitespace-nowrap"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>نوع الإجراء</span>
                        {renderSortIndicator('output_type')}
                      </div>
                    </th>

                    {/* Date and Time Column with Sort */}
                    <th 
                      onClick={() => handleSort('output_datetime')}
                      className="py-2.5 px-3 font-bold text-white border-l border-white/5 cursor-pointer hover:bg-white/5 transition-colors whitespace-nowrap"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>تاريخ ووقت الإجراء</span>
                        {renderSortIndicator('output_datetime')}
                      </div>
                    </th>

                    {/* System User Column with Sort */}
                    <th 
                      onClick={() => handleSort('user_id')}
                      className="py-2.5 px-3 font-bold text-white border-l border-white/5 cursor-pointer hover:bg-white/5 transition-colors whitespace-nowrap"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>مستخدم النظام</span>
                        {renderSortIndicator('user_id')}
                      </div>
                    </th>

                    {/* Document ID Column with Sort */}
                    <th 
                      onClick={() => handleSort('document_id')}
                      className="py-2.5 px-3 font-bold text-white cursor-pointer hover:bg-white/5 transition-colors whitespace-nowrap"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>معرف المستند (ID)</span>
                        {renderSortIndicator('document_id')}
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/5 font-cairo">
                  {paginatedRecords.map((item, idx) => {
                    const dt = formatDateTime(item.output_datetime);
                    const userLabel = getUserDisplayLabel(item.user_id);
                    const absoluteIndex = startIndex + idx + 1;

                    return (
                      <tr 
                        key={item.id || idx} 
                        className="hover:bg-white/[0.03] transition-colors group"
                      >
                        {/* 1. Index */}
                        <td className="py-2.5 px-3 text-center font-mono font-bold text-gray-500 border-l border-white/5">
                          {absoluteIndex}
                        </td>

                        {/* 2. Document Number */}
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-400 border-l border-white/5 whitespace-nowrap">
                          #{item.document_number || '---'}
                        </td>

                        {/* 3. Document Name */}
                        <td className="py-2.5 px-3 font-bold text-white border-l border-white/5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <FileText size={14} className="text-gray-400 shrink-0" />
                            <span>{item.document_name || 'مستند أجهزة'}</span>
                          </div>
                        </td>

                        {/* 4. Output Type */}
                        <td className="py-2.5 px-3 text-center border-l border-white/5 whitespace-nowrap">
                          {renderOutputTypeBadge(item.output_type)}
                        </td>

                        {/* 5. Date & Time */}
                        <td className="py-2.5 px-3 border-l border-white/5 whitespace-nowrap">
                          <div className="flex flex-col text-[11px] leading-tight">
                            <span className="font-mono text-gray-200 font-bold">{dt.date}</span>
                            <span className="font-mono text-gray-400 text-[10px] mt-0.5">{dt.time}</span>
                          </div>
                        </td>

                        {/* 6. System User */}
                        <td className="py-2.5 px-3 font-bold text-gray-200 border-l border-white/5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-gray-400 shrink-0">
                              <UserIcon size={12} />
                            </div>
                            <span className="text-xs text-white">{userLabel}</span>
                          </div>
                        </td>

                        {/* 7. Document ID */}
                        <td className="py-2.5 px-3 font-mono text-[10px] text-gray-400 max-w-[150px] truncate" title={item.document_id}>
                          <span className="px-2 py-0.5 rounded bg-black/30 border border-white/5 select-all">
                            {item.document_id || '---'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 4. Pagination Footer Bar (Mobile & Android APK Compatible with Safe Area) */}
      <div className="shrink-0 bg-[#1a1a1a] border-t border-white/10 px-3 sm:px-6 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2.5 text-xs pb-[max(env(safe-area-inset-bottom,0px),12px)]">
        {/* Left: Rows Per Page & Record Range */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 font-medium text-[11px] sm:text-xs">عرض الأسطر:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-[#121212] border border-white/10 text-white rounded-lg px-2 py-1 text-xs font-bold focus:outline-none focus:border-purple-500 cursor-pointer"
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="text-gray-400 font-mono text-[11px] sm:text-xs">
            عرض <span className="text-white font-bold">{filteredRecords.length === 0 ? 0 : startIndex + 1}</span> - <span className="text-white font-bold">{endIndex}</span> من أصل <span className="text-purple-400 font-bold">{filteredRecords.length}</span>
          </div>
        </div>

        {/* Right: Page Switcher Buttons */}
        <div className="flex items-center gap-1 sm:gap-1.5 mr-auto sm:mr-0">
          {/* First Page */}
          <button
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={validCurrentPage <= 1}
            className="p-1.5 sm:px-2.5 sm:py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-gray-300 hover:text-white rounded-lg border border-white/10 flex items-center gap-1 transition-all cursor-pointer text-xs font-bold"
            title="الصفحة الأولى"
          >
            <ChevronsRight size={15} />
            <span className="hidden sm:inline">الأولى</span>
          </button>

          {/* Previous Page */}
          <button
            type="button"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={validCurrentPage <= 1}
            className="p-1.5 sm:px-2.5 sm:py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-gray-300 hover:text-white rounded-lg border border-white/10 flex items-center gap-1 transition-all cursor-pointer text-xs font-bold"
            title="الصفحة السابقة"
          >
            <ChevronRight size={15} />
            <span className="hidden sm:inline">السابق</span>
          </button>

          {/* Current Page Pill */}
          <div className="px-2.5 sm:px-3 py-1 bg-purple-600/20 border border-purple-500/40 text-purple-300 rounded-lg font-mono font-bold text-xs">
            {validCurrentPage} / {totalPages}
          </div>

          {/* Next Page */}
          <button
            type="button"
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={validCurrentPage >= totalPages}
            className="p-1.5 sm:px-2.5 sm:py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-gray-300 hover:text-white rounded-lg border border-white/10 flex items-center gap-1 transition-all cursor-pointer text-xs font-bold"
            title="الصفحة التالية"
          >
            <span className="hidden sm:inline">التالي</span>
            <ChevronLeft size={15} />
          </button>

          {/* Last Page */}
          <button
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={validCurrentPage >= totalPages}
            className="p-1.5 sm:px-2.5 sm:py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none text-gray-300 hover:text-white rounded-lg border border-white/10 flex items-center gap-1 transition-all cursor-pointer text-xs font-bold"
            title="الصفحة الأخيرة"
          >
            <span className="hidden sm:inline">الأخيرة</span>
            <ChevronsLeft size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
