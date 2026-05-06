'use client';

import Image from 'next/image';
import React from 'react';

export default function OrgChartDraft() {
  // Component tái sử dụng cho các Node chính
  const NodeCard = ({ title, subtitle, className = '' }: { title: string; subtitle?: string; className?: string }) => (
    <div className={`border-2 border-green-700 bg-white rounded-3xl p-3 text-center shadow-sm z-10 relative ${className}`}>
      <div className="font-bold text-gray-800 text-sm">{title}</div>
      {subtitle && <div className="text-xs text-gray-600 font-semibold mt-1 whitespace-pre-line">{subtitle}</div>}
    </div>
  );

  // Component tái sử dụng cho danh sách nhân sự (Node lá)
  const LeafList = ({ items }: { items: string[] }) => (
    <div className="text-left text-xs font-semibold text-gray-700 mt-2 pl-4 border-l-2 border-green-700">
      {items.map((item, idx) => (
        <div key={idx} className="relative before:content-[''] before:absolute before:-left-4 before:top-2 before:w-3 before:h-0.5 before:bg-green-700">
          {item}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8 overflow-x-auto">
      <div className="min-w-[1200px] flex flex-col items-center gap-8 relative">
        <div className="w-full max-w-5xl rounded-[2rem] border border-emerald-100 bg-white/95 px-8 py-6 shadow-lg">
          <div className="flex items-center justify-center gap-6">
            <div className="flex h-28 w-28 items-center justify-center rounded-full border border-emerald-200 bg-white p-3 shadow-sm">
              <Image
                src="/logo-phk-moi.png"
                alt="Logo PHK"
                width={96}
                height={96}
                className="h-20 w-20 object-contain"
                priority
              />
            </div>
            <div className="text-center">
              <h1 className="text-3xl font-extrabold uppercase tracking-tight text-emerald-900">
                CTY TNHH PTCS PHƯỚC HÒA KAMPONG THOM-NHÀ MÁY CHẾ BIẾN
              </h1>
            </div>
          </div>
        </div>

        {/* LEVEL 1: QUẢN ĐỐC */}
        <div className="relative flex flex-col items-center">
          <NodeCard 
            title="QUẢN ĐỐC" 
            className="w-64 text-xl py-4 uppercase border-[3px]"
          />
          {/* Đường dọc từ Quản đốc xuống Level 2 */}
          <div className="w-0.5 h-8 bg-green-700"></div>
        </div>

        {/* LEVEL 2: PHÓ QUẢN ĐỐC */}
        <div className="w-full max-w-5xl flex justify-between relative">
          {/* Đường ngang nối 2 Phó Quản Đốc */}
          <div className="absolute top-0 left-[20%] right-[20%] h-0.5 bg-green-700 -mt-8"></div>
          {/* Đường dọc phụ nối xuống Phó QĐ */}
          <div className="absolute top-0 left-[20%] w-0.5 h-8 bg-green-700 -mt-8"></div>
          <div className="absolute top-0 right-[20%] w-0.5 h-8 bg-green-700 -mt-8"></div>

          <NodeCard 
            title="PHÓ QUẢN ĐỐC" 
            subtitle={"Phụ trách đội xe cơ khí\nPhiên dịch - Nhân sự"} 
            className="w-72 mx-auto"
          />
          <NodeCard 
            title="PHÓ QUẢN ĐỐC" 
            subtitle={"Phụ trách chất lượng\nISO"} 
            className="w-72 mx-auto"
          />
        </div>

        {/* LEVEL 3: NHÂN VIÊN */}
        <div className="w-full max-w-6xl flex justify-between gap-4 mt-4 relative">
          {/* Chú ý: Các đường nét đứt (quan hệ hỗ trợ) được mô phỏng bằng viền đứt */}
          <NodeCard 
            title="Nhân viên" 
            subtitle="Đội xe - Thủ kho" 
            className="w-56"
          />
          <NodeCard 
            title="Nhân viên" 
            subtitle="Cơ điện - Năng lượng" 
            className="w-56"
          />
          <NodeCard 
            title="Nhân viên" 
            subtitle="Kế toán - Tổ chức" 
            className="w-56"
          />
          <NodeCard 
            title="Nhân viên" 
            subtitle="Kỹ thuật chế biến - Môi trường" 
            className="w-64"
          />
        </div>

        {/* LEVEL 4 & 5: TỔ/ĐỘI VÀ CHI TIẾT */}
        <div className="w-full flex justify-between items-start mt-8 gap-2">
          
          {/* Nhánh 1 */}
          <div className="flex flex-col items-center w-48">
            <div className="w-0.5 h-8 bg-green-700 mb-2"></div>
            <NodeCard title="Đội xe - Cơ khí" className="w-full" />
            <div className="w-full mt-2">
              <LeafList items={["Sửa chữa cơ khí", "Tài xế", "Xe cơ giới"]} />
            </div>
          </div>

          {/* Nhánh 2 */}
          <div className="flex flex-col items-center w-48">
            <div className="w-0.5 h-8 bg-green-700 mb-2"></div>
            <NodeCard title="Tổ trưởng" subtitle="Tổ bảo trì" className="w-full" />
            <div className="w-full mt-2">
              <LeafList items={["CN bảo trì"]} />
            </div>
          </div>

          {/* Nhánh 3 */}
          <div className="flex flex-col items-center w-48">
            <div className="w-0.5 h-8 bg-green-700 mb-2"></div>
            <NodeCard title="Tổ bốc vác" subtitle="Bếp - Tạp vụ" className="w-full" />
            <div className="w-full mt-2">
              <LeafList items={["Bốc vác", "Phục vụ", "Tạp vụ"]} />
            </div>
          </div>

          {/* Nhóm Kỹ thuật chế biến (Chia làm 4 nhánh con) */}
          <div className="flex justify-between gap-4 relative flex-1 ml-4 border-t-2 border-green-700 pt-8 mt-4">
            {/* Đường nối dọc từ Nhân viên KT xuống đường ngang */}
            <div className="absolute -top-12 left-1/2 w-0.5 h-12 bg-green-700"></div>
            
            {/* Các đường nối dọc xuống các tổ */}
            <div className="absolute top-0 left-[12%] w-0.5 h-8 bg-green-700"></div>
            <div className="absolute top-0 left-[38%] w-0.5 h-8 bg-green-700"></div>
            <div className="absolute top-0 right-[38%] w-0.5 h-8 bg-green-700"></div>
            <div className="absolute top-0 right-[12%] w-0.5 h-8 bg-green-700"></div>

            {/* 4.1 */}
            <div className="flex flex-col items-center w-40">
              <NodeCard title="Tổ trưởng" subtitle="Tổ tiếp nhận đánh đông" className="w-full" />
              <div className="w-full mt-2">
                <LeafList items={["CN tiếp nhận", "CN nướng DRC", "CN pha chế", "CN đánh đông"]} />
              </div>
            </div>

            {/* 4.2 */}
            <div className="flex flex-col items-center w-40">
              <NodeCard title="Ca trưởng" subtitle="Mủ tạp - mủ nước" className="w-full" />
              <div className="w-full mt-2">
                <LeafList items={[
                  "CN cán kéo",
                  "CN cán băm",
                  "CN phả mủ",
                  "CN ra lò",
                  "CN cân ép",
                  "CN bao gói",
                  "CN vô kiện",
                  "CN nhặt rác"
                ]} />
              </div>
            </div>

            {/* 4.3 */}
            <div className="flex flex-col items-center w-40">
              <NodeCard title="Tổ xé - tiếp nhận" subtitle="Nguyên liệu" className="w-full" />
              <div className="w-full mt-2">
                <LeafList items={["CN cán xé"]} />
              </div>
            </div>

            {/* 4.4 */}
            <div className="flex flex-col items-center w-40">
              <NodeCard title="Hệ thống" subtitle="Xử lý nước thải" className="w-full" />
              <div className="w-full mt-2">
                <LeafList items={["CN vận hành hệ thống"]} />
              </div>
            </div>
          </div>
        </div>

        {/* Chú thích */}
        <div className="absolute bottom-0 left-0 p-4 border rounded bg-white shadow-sm">
          <div className="font-bold underline mb-2">Chú thích</div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-0.5 bg-green-700"></div>
            <span className="text-sm">Quan hệ trực tiếp</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 border-t-2 border-dashed border-green-700"></div>
            <span className="text-sm">Quan hệ gián tiếp, hỗ trợ</span>
          </div>
        </div>

      </div>
    </div>
  );
}
