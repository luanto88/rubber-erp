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

```typescript
const handleSave = async () => {
  if (!factoryId) return
  setSaving(true)
  const payload = { ...form, factory_id: factoryId }

  if (editId) {
    await supabase.from("table").update(payload).eq("id", editId)
  } else {
    await supabase.from("table").insert(payload)
  }

  setSaving(false)
  setModal(null)
  loadData(factoryId) // bắt buộc refresh sau save
}
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
