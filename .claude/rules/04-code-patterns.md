---
description: Patterns code chuẩn — dùng khi viết mới hoặc sửa bất kỳ page/component nào
---

# Code Patterns & Conventions

## Fetch data pattern

```typescript
import { getActiveFactoryId } from "@/lib/auth"

const loadData = useCallback(async (fid: string) => {
  setLoading(true)
  try {
    const { data } = await supabase
      .from("table_name")
      .select("*, related_table(field1, field2)")
      .eq("factory_id", fid)
      .order("created_at", { ascending: false })
    setData(data || [])
  } finally {
    setLoading(false)
  }
}, [filterDep1, filterDep2]) // chỉ dependencies là filters

// Bootstrap - chỉ chạy 1 lần khi mount để lấy factory ID
useEffect(() => {
  const bootstrap = async () => {
    const fid = await getActiveFactoryId()
    if (!fid) {
      setLoading(false)
      return
    }
    setFactoryId(fid)
    loadData(fid)
  }
  void bootstrap()
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []) // KHÔNG đặt loadData vào đây

// Reload khi filter thay đổi (sau khi đã có factoryId)
useEffect(() => {
  if (factoryId) loadData(factoryId)
}, [factoryId, loadData])
```

Quy tac bat buoc:

- **Bootstrap effect PHẢI có deps `[]`** — không phụ thuộc vào `loadData`
- Nếu `loadData` có filter dependencies, dùng effect riêng `[factoryId, loadData]` để reload khi filter đổi
- Đặt `loadData` vào deps của bootstrap sẽ gây re-run `getActiveFactoryId()` mỗi khi filter thay đổi — lãng phí DB call
- Ham `loadData()` phai co `try/finally` neu co bat/tat `loading`
- Khong duoc `return` som sau `setLoading(true)` ma bo quen ha `loading`
- Khong duoc phu thuoc cung nhac vao `localStorage.getItem("erp_factory")` trong page/module
- Uu tien helper `getActiveFactoryId()` de tu phuc hoi `factory_id` neu cache session bi mat

### Bootstrap khi can ca factoryId lan user (vi du settings page)

```typescript
const bootstrap = useCallback(async () => {
  const fid = await getActiveFactoryId()
  if (!fid) { setLoading(false); return }

  const { user: sessionUser } = await hydrateActiveSession()
  if (!sessionUser) { setLoading(false); return }

  setFactoryId(fid)
  setUser(sessionUser)
  await loadData(fid)
  setLoading(false)
}, [loadData])
```

Khong duoc dung `localStorage.getItem("erp_factory")` hay `localStorage.getItem("erp_user")` truc tiep trong bootstrap — cache co the chua duoc set tai thoi diem bootstrap chay.

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

## Phan biet loading / error / empty

- `Dang tai...` chi dung khi request dang chay that
- `Khong co du lieu` chi dung khi request thanh cong va ket qua rong
- Neu request auth/session bi loi hoac session het han:
  - khong duoc gia lam empty state
  - phai cho co che auth/layout xu ly lai session hoac day ve login
