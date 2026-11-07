$path = "analyze.mjs"
$text = Get-Content $path -Raw -Encoding UTF8
$pairs = @(
  @("      metric: '标题质量',`r`n    });", "      metric: '标题质量',`r`n      goal: '曝光',`r`n    });"),
  @("      metric: '涨粉',`r`n    });", "      metric: '涨粉',`r`n      goal: '涨粉',`r`n    });"),
  @("      metric: '更新频率',`r`n    });", "      metric: '更新频率',`r`n      goal: '曝光',`r`n    });"),
  @("      metric: '发布时段',`r`n    });", "      metric: '发布时段',`r`n      goal: '曝光',`r`n    });"),
  @("      metric: '播放趋势',`r`n    });", "      metric: '播放趋势',`r`n      goal: '曝光',`r`n    });"),
  @("      metric: '样本量',`r`n    });", "      metric: '样本量',`r`n      goal: '',`r`n    });"),
  @("      metric: '作品形态',`r`n    });", "      metric: '作品形态',`r`n      goal: '曝光',`r`n    });")
)
foreach ($p in $pairs) { $text = $text.Replace($p[0], $p[1]) }
Set-Content $path -Value $text -Encoding UTF8 -NoNewline
