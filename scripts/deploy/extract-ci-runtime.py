"""Extract only immutable runtime outputs, without following archive links.

Runs as the isolated build user, after the controller checks CI provenance and
the compressed digest. No extractall(), overwrite, hard links or device files.
Uses the Python standard library already present on the supported Ubuntu host.
"""
import os
import posixpath
import shutil
import sys
import tarfile
import zipfile


def unzip(archive, destination):
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if sorted(item.filename for item in members) != ["runtime.json", "runtime.tar.gz"]:
            raise ValueError("unexpected ZIP entries")
        for member in members:
            limit = 8192 if member.filename == "runtime.json" else 2 * 1024 ** 3
            if member.file_size < 1 or member.file_size > limit or member.flag_bits & 1:
                raise ValueError("invalid ZIP member size or encryption")
        for member in members:
            with bundle.open(member) as source, open(os.path.join(destination, member.filename), "xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)


def allowed(name):
    return name == ".build-complete" or name in (".next", "node_modules") or name.startswith((".next/", "node_modules/"))


def unpack(archive, destination):
    if os.path.realpath(destination) != destination or not os.path.isdir(destination):
        raise ValueError("destination must be a real directory")
    with tarfile.open(archive, "r:gz") as bundle:
        members = []
        names = set()
        total = 0
        for member in bundle:
            name = member.name.rstrip("/")
            if (not name or not allowed(name) or "\\" in name or
                    any(ord(char) < 32 or ord(char) == 127 for char in name) or
                    any(part in ("", ".", "..") for part in name.split("/")) or
                    name == ".next/cache" or name.startswith(".next/cache/") or name in names):
                raise ValueError("unsafe or duplicate archive path")
            if not (member.isdir() or member.isfile() or member.issym()) or member.mode & 0o7000:
                raise ValueError("unsupported archive entry")
            if name in (".next", "node_modules") and not member.isdir():
                raise ValueError("artifact roots must be directories")
            if name == ".build-complete" and not member.isfile():
                raise ValueError("build marker must be a file")
            if member.issym():
                target = member.linkname
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                if (not target or target.startswith("/") or "\\" in target or
                        any(ord(char) < 32 or ord(char) == 127 for char in target) or
                        not resolved.startswith("node_modules/") or not name.startswith("node_modules/")):
                    raise ValueError("archive link escapes dependencies")
            if member.size < 0 or member.size > 512 * 1024 * 1024:
                raise ValueError("oversized archive member")
            total += member.size
            if total > 12 * 1024 ** 3 or len(members) >= 200000:
                raise ValueError("archive exceeds extraction budget")
            names.add(name)
            members.append((name, member))
        if not {".next", "node_modules", ".build-complete"}.issubset(names):
            raise ValueError("incomplete runtime archive")
        links = {name for name, member in members if member.issym()}
        files = {name for name, member in members if member.isfile()}
        for name in names:
            parent = posixpath.dirname(name)
            while parent:
                if parent in links or parent in files:
                    raise ValueError("archive ancestor is not a directory")
                parent = posixpath.dirname(parent)
        # The preparer creates these empty output slots; nothing else is replaced.
        marker = os.path.join(destination, ".build-complete")
        if os.path.lexists(marker):
            stat = os.lstat(marker)
            if not os.path.isfile(marker) or os.path.islink(marker) or stat.st_size != 0 or stat.st_nlink != 1:
                raise ValueError("build marker slot is not empty")
            os.unlink(marker)
        for root in (".next", "node_modules"):
            path = os.path.join(destination, root)
            if os.path.lexists(path) and (os.path.islink(path) or not os.path.isdir(path) or os.listdir(path)):
                raise ValueError("runtime output slot is not empty")
        for name, member in sorted(members, key=lambda entry: (entry[0].count("/"), entry[0])):
            path = os.path.join(destination, name)
            parent = os.path.dirname(path)
            os.makedirs(parent, mode=0o700, exist_ok=True)
            if os.path.realpath(parent) != parent:
                raise ValueError("destination ancestor is a link")
            if member.isdir():
                os.makedirs(path, mode=0o700, exist_ok=True)
                if os.path.islink(path) or not os.path.isdir(path):
                    raise ValueError("destination directory changed")
            elif member.isfile():
                with bundle.extractfile(member) as source, open(path, "xb") as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                os.chmod(path, 0o700 if member.mode & 0o111 else 0o600)
        # Create links last: no file write ever traverses an archive-provided link.
        for name, member in members:
            if member.issym():
                os.symlink(member.linkname, os.path.join(destination, name))


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: extract-ci-runtime.py <archive> <workspace>")
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "--zip":
            unzip(sys.argv[2], sys.argv[3])
        elif len(sys.argv) == 3:
            unpack(sys.argv[1], sys.argv[2])
        else:
            raise ValueError("invalid arguments")
    except Exception:
        raise SystemExit("CI runtime extraction refused; preserve candidate diagnostics") from None
