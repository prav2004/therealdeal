import os, sys

filepath = os.path.join(os.path.dirname(__file__), '..', 'public', 'index.html')
with open(filepath, 'r', encoding='utf-8') as f:
    data = f.read()

start_marker = '      body { padding-top: 64px; }\n    </style>'
end_marker = '    </header>\n    <!-- Main Content -->'

start_idx = data.index(start_marker)
end_idx = data.index(end_marker) + len(end_marker)

new_section = """      body { padding-top: 64px; }
    </style>
  </head>
  <body class="flex flex-col min-h-screen">
    <!-- Sticky top banner -->
    <div class="top-banner">
      <a href="index.html" class="flex-shrink-0"><img src="logo.png" alt="Pickr" class="banner-logo" /></a>
      <div class="banner-right">
        <div class="banner-player">
          <div class="pickr-avatar" data-size="30" aria-hidden="true"></div>
          <div class="banner-name header-screen-name">\u2014</div>
        </div>
        <div class="banner-balances">
          <div class="banner-bal banner-bal-token">
            <span class="bal-dot"></span>
            <span id="headerTokens" class="tokens">0</span>
          </div>
          <div class="banner-bal banner-bal-cash">
            <span class="bal-dot"></span>
            <span id="headerCash" class="cash">$0</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Page header -->
    <header class="bg-gray-800 text-gray-100 shadow p-3 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-gray-700">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div class="space-y-2">
          <h2 class="hero-title text-2xl sm:text-3xl">Tonight's lines, curated.</h2>
          <p class="text-slate-400 text-sm sm:text-base">Scan the hottest matchups, tap a side, and build a bet slip in seconds. Our confidence tags highlight the strongest edges.</p>
          <div class="chip inline-flex">Live odds</div>
        </div>
      </div>
    </header>
    <!-- Main Content -->"""

data = data[:start_idx] + new_section + data[end_idx:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(data)

print('index.html updated successfully')
