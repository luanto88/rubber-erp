---
description: Patterns code chuẩn — dùng khi viết mới hoặc sửa bất kỳ page/component nào
---

# Code Patterns & Conventions

## Fetch data pattern

```typescript
const loadData = useCallback(async (fid: string) => {
  setLoading(true)
  const { data } = await supabase
    .from("table_name")
    .select("*, related_table(field1, field2)")
    .eq("factory_id", fid)
    .order("created_at", { ascending: false })
  setData(data || [])
  setLoading(false)
}, [filterDep1, filterDep2]) // chỉ dependencies là filters

useEffect(() => {
  const fid = localStorage.getItem("erp_factory")
  if (!fid) return
  setFactoryId(fid)
  loadData(fid)
}, [loadData])
```

## Save/Update pattern

> ⚠️ **Supabase JS v2 KHÔNG throw exception khi lỗi DB** — luôn kiểm tra `error` object.  
> Nếu chỉ dùng `await supabase...` mà không check `error`, lỗi insert/update bị bỏ qua.

```typescript
const [saveError, setSaveError] = useState<string | null>(null)

const handleSave = async () => {
  if (!factoryId) return
  setSaving(true)
  setSaveError(null)
  const payload = { ...form, factory_id: factoryId }

  if (editId) {
    const { error } = await supabase.from("table").update(payload).eq("id", editId)
    if (error) { setSaveError(error.message); setSaving(false); return }
  } else {
    const { error } = await supabase.from("table").insert(payload)
    if (error) { setSaveError(error.message); setSaving(false); return }
  }

  setSaving(false)
  setModal(null)
  loadData(factoryId) // bắt buộc refresh sau save
}
```

### Toast lỗi (hiển thị saveError)

```tsx
{saveError && (
  <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
    <AlertTriangle size={16} className="shrink-0"/>
    <span className="text-sm font-bold">{saveError}</span>
    <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14}/></button>
  </div>
)}
```

## Delete pattern

```typescript
const handleDelete = async (id: string) => {
  if (!factoryId) return
  // Phải có confirm dialog trước khi delete
  await supabase.from("table").delete().eq("id", id)
  setDelConfirm(null)
  loadData(factoryId)
}
```

## State structure cho CRUD page

```typescript
// Data
const [items, setItems] = useState<Item[]>([])
const [loading, setLoading] = useState(true)
const [factoryId, setFactoryId] = useState<string | null>(null)

// Filters
const [search, setSearch] = useState("")
const [filterX, setFilterX] = useState("")

// Modal/Form
const [modal, setModal] = useState<"add" | "edit" | null>(null)
const [form, setForm] = useState(emptyForm())
const [editId, setEditId] = useState<string | null>(null)
const [saving, setSaving] = useState(false)
const [delConfirm, setDelConfirm] = useState<string | null>(null)
```

## View states (thay vì modal cho page phức tạp)

```typescript
const [view, setView] = useState<"list" | "add" | "detail">("list")
const [selected, setSelected] = useState<Item | null>(null)
```

## Auto-calc pattern

```typescript
const updateForm = (patch: Partial<typeof form>) => {
  setForm(prev => {
    const next = { ...prev, ...patch }
    // Tính toán derived values
    next.tong_banh = next.kien_a + next.kien_b + next.kien_c + next.kien_d
    next.tong_kg = next.tong_banh * next.loai_banh
    return next
  })
}
```

## Empty state pattern

```typescript
{loading ? (
  <div className="p-12 text-center text-slate-400">Đang tải...</div>
) : filtered.length === 0 ? (
  <div className="p-12 text-center text-slate-400">
    <IconComponent size={40} className="mx-auto mb-3 opacity-30"/>
    <p>Không có dữ liệu</p>
  </div>
) : (
  // render content
)}
```
