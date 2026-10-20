-- 版本号与 build_info.h 由 git 提交派生：YYYY.M.D.HHMM 正好对应 VERSIONINFO 的 4 段数字，
-- 因此同一提交在任意机器上得到同一版本号，不需要手工维护。
--
-- 放在规则里而不是 xmake.lua 顶层：顶层作用域没有 os.iorunv 与 io，只有规则/钩子的脚本作用域才有。

rule("build_info")
    on_load(function (target)
        local info = try { function ()
            return os.iorunv("git", {"show", "-s", "--format=%H;%cI;%cd",
                "--date=format:%Y,%m,%d,%H%M", "HEAD"}):trim()
        end } or ""

        local hash, committed_at, stamp = info:match("^([^;]+);([^;]+);(.+)$")
        local year, month, day, hhmm = (stamp or ""):match("^(%d+),(%d+),(%d+),(%d+)$")
        local commit = hash and hash:sub(1, 8) or "unknown"

        local version = string.format("%s.%s.%s.%s",
            year or "0", month or "0", day or "0", hhmm or "0")

        local header = io.readfile(path.join(os.projectdir(), "resources", "build_info.h.in"))
        header = header:gsub("@YEAR@", year or "0"):gsub("@MONTH@", month or "0")
        header = header:gsub("@DAY@", day or "0"):gsub("@HHMM@", hhmm or "0")
        header = header:gsub("@VERSION@", version):gsub("@COMMIT@", commit)
        header = header:gsub("@COMMITTED_AT@", committed_at or "")

        local generated_dir = path.join(os.projectdir(), "build", "generated")
        os.mkdir(generated_dir)
        io.writefile(path.join(generated_dir, "build_info.h"), header)
    end)
