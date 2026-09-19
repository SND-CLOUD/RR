sed -i "s/const itemDate = parseDate(item.createdAt);/if (timeRange === 'all') return true;\n          const itemDate = parseDate(item.createdAt);/" src/components/Reports.tsx
