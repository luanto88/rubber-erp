new_master_data = '''      {tab === "master-data" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
            <div className="flex gap-2">
              {[
                { key: "suffixes" as const, label: "Hậu tố lô", icon: Tag },
                { key: "company" as const, label: "Thông tin công ty", icon: Building2 },
                { key: "customers" as const, label: "Khách hàng", icon: ShoppingBag },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setMasterDataTab(item.key)}
                  className={
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all " +
                    (masterDataTab === item.key
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "text-slate-600 hover:bg-slate-50")
                  }
                >
                  <item.icon size={14} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {masterDataTab === "suffixes" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={16} className="text-emerald-600" />
                <span className="font-extrabold text-slate-700">Hậu tố lô</span>
                <span className="text-xs text-slate-500 ml-1">({suffixes.length} hậu tố)</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 hidden md:block">Ký tự hậu tố dùng trong mã lô (VD: 01cs/26) và phân loại lô sản phẩm</span>
                {canManageSettings && (
                  <button
                    onClick={openAdd}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    <Plus size={13} /> Thêm hậu tố
                  </button>
                )}
              </div>
            </div>

            <div className="p-4">
              {loading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : suffixes.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Tag size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Chưa có hậu tố nào</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã", "Tên", "Nguồn gốc", "Chứng nhận", "Ví dụ mã lô", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suffixes.map((item) => (
                      <tr key={item.code} className="row-hover">
                        <td className="px-4 py-3">
                          <span className="font-bold text-emerald-700 font-mono">{item.code}</span>
                          {SYSTEM_CODES.includes(item.code) && (
                            <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">
                              Hệ thống
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-500">{item.nguon || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{item.chung_nhan || "—"}</td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">{`01${item.code}/26`}</td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEdit(item)}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setDelConfirm(item.code)}
                                className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          )}

          {masterDataTab === "company" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-violet-600" />
                <span className="font-extrabold text-slate-700">Thông tin công ty (EUDR Seller)</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={handleSaveFactory}
                  disabled={savingFactory}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  <Save size={13} /> {savingFactory ? "Đang lưu..." : "Lưu thông tin"}
                </button>
              )}
            </div>

            <div className="p-5">
              {factoryMsg && (
                <div
                  className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 ${
                    factoryMsg.ok
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-red-50 text-red-600 border border-red-200"
                  }`}
                >
                  {factoryMsg.ok ? <Save size={14} /> : <AlertTriangle size={14} />} {factoryMsg.text}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Tên công ty (tiếng Anh)", field: "full_name_en", colSpan: true },
                  { label: "Địa chỉ", field: "address_en", colSpan: true },
                  { label: "Người liên hệ", field: "contact_person", colSpan: false },
                  { label: "Email", field: "contact_email", colSpan: false },
                  { label: "Website", field: "website", colSpan: false },
                  { label: "Quốc gia", field: "country_en", colSpan: false },
                ].map(({ label, field, colSpan }) => (
                  <div key={field} className={colSpan ? "col-span-2" : ""}>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">{label}</label>
                    <input
                      value={factoryInfo[field as keyof FactoryInfo]}
                      onChange={(e) => setFactoryInfo((prev) => ({ ...prev, [field]: e.target.value }))}
                      disabled={!canManageSettings}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}

          {masterDataTab === "customers" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag size={16} className="text-blue-600" />
                <span className="font-extrabold text-slate-700">Khách hàng</span>
                <span className="text-xs text-slate-400 ml-1">({customers.length} khách hàng)</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={() => {
                    setCustomerEditId(null)
                    setCustomerForm({ ma_kh: "", ten_kh_en: "", email: "", dia_chi: "" })
                    setCustomerError("")
                    setCustomerModal("add")
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  <Plus size={13} /> Thêm khách hàng
                </button>
              )}
            </div>

            <div className="overflow-hidden">
              {customerLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : customers.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Chưa có khách hàng nào</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã KH", "Tên khách hàng", "Email", "Địa chỉ", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.map((c) => (
                      <React.Fragment key={c.id}>
                        <tr
                          className={"row-hover cursor-pointer " + (expandedCustomerId === c.id ? "bg-blue-50" : "")}
                          onClick={() => setExpandedCustomerId(expandedCustomerId === c.id ? null : c.id)}
                        >
                          <td className="px-4 py-3 font-mono font-bold text-blue-700">{c.ma_kh || "—"}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{c.ten_kh_en || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{c.email || "—"}</td>
                          <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{c.dia_chi || "—"}</td>
                          <td className="px-4 py-3">
                            {canManageSettings && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setCustomerEditId(c.id)
                                    setCustomerForm({ ma_kh: c.ma_kh || "", ten_kh_en: c.ten_kh_en || "", email: c.email || "", dia_chi: c.dia_chi || "" })
                                    setCustomerError("")
                                    setCustomerModal("edit")
                                  }}
                                  className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCustomerDelConfirm({ id: c.id, label: c.ten_kh_en || c.ma_kh || "khách hàng" }) }}
                                  className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {expandedCustomerId === c.id && (
                          <tr>
                            <td colSpan={5} className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><span className="font-bold text-slate-600">Mã KH: </span><span className="text-slate-800">{c.ma_kh || "—"}</span></div>
                                <div><span className="font-bold text-slate-600">Tên: </span><span className="text-slate-800">{c.ten_kh_en || "—"}</span></div>
                                <div><span className="font-bold text-slate-600">Email: </span><span className="text-slate-800">{c.email || "—"}</span></div>
                                <div className="col-span-2"><span className="font-bold text-slate-600">Địa chỉ: </span><span className="text-slate-800">{c.dia_chi || "—"}</span></div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          )}
        </div>
      )}

'''

with open(r'c:/Users/Software/rubber-erp/src/app/dashboard/settings/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Verify boundaries
print("Start:", repr(lines[2113][:80]))
print("End:", repr(lines[2192][:80]))

new_lines = lines[:2113] + [new_master_data] + lines[2193:]

with open(r'c:/Users/Software/rubber-erp/src/app/dashboard/settings/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print(f"Done. Total lines: {len(new_lines)}")
