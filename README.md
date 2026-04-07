# 🚀 BrandPoster — Multi Account Facebook Dashboard

Multiple Facebook Account থেকে Text, Image ও Video post করার tool।

---

## ⚡ Setup (মাত্র ৩টি step)

### Step 1 — Node.js install করো
https://nodejs.org থেকে LTS version download করে install করো।

### Step 2 — Dependencies install করো
```
এই folder-এ terminal/cmd খুলে run করো:

npm install
```

### Step 3 — Server চালু করো
```
node server.js
```

Browser-এ যাও: **http://localhost:3000**

---

## 📱 Facebook Access Token পাওয়ার পদ্ধতি

1. https://developers.facebook.com → Login
2. "My Apps" → তোমার App open করো (না থাকলে নতুন create করো)
3. বাম দিকে "Tools" → **Graph API Explorer**
4. উপরে dropdown থেকে তোমার Page select করো
5. **"Generate Access Token"** click করো
6. Permission add করো:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `pages_manage_metadata`
7. Token copy করো → Dashboard-এ paste করো

> ⚠️ **Long-lived token** use করো। Short-lived token 1 ঘণ্টায় expire হয়।
> Long-lived করতে: https://developers.facebook.com/tools/explorer → "Get Long-Lived Token"

---

## 🎯 Features

- ✅ Multiple Facebook Page / Business Account manage
- ✅ Text post
- ✅ Image post (JPG, PNG, GIF)
- ✅ Video post (MP4, MOV — 100MB পর্যন্ত)
- ✅ একসাথে সব account-এ post
- ✅ Account test (connection check)
- ✅ Post history log
- ✅ Data save হয় (accounts.json file-এ)

---

## 📁 File Structure
```
brandposter/
├── server.js        ← Backend (Express)
├── package.json     ← Dependencies
├── accounts.json    ← Saved accounts (auto-created)
├── public/
│   └── index.html   ← Dashboard UI
└── uploads/         ← Temporary file uploads
```
"# brandposter" 
