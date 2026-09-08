---
'@amritk/mjst': minor
---

Drop `.mjst-manifest.json` and the ownership check it existed for

Generation used to record every path it wrote in a `.mjst-manifest.json` at the
root of the output directory, and refuse to replace any file that record did not
claim. That put a bookkeeping sidecar in everyone's output directory — and, with
`--out-file src/types.ts`, in the middle of hand-written source — to guard
against something version control already shows and reverts.

**Breaking:** a generated file now replaces whatever sits at its path, without
asking. Point `--out-dir` at a directory you are happy to have overwritten, and
review the diff the way you would any other generated output. No manifest is
written, and an existing one is inert — delete it.

`--force` is deprecated. It is still accepted, so scripts and config files
carrying it keep working, but it does nothing and warns; drop it at your
convenience.

What has not changed is the guarantee that motivated the manifest in the first
place: `--build` still only ever removes the intermediate `.ts` sources the run
itself generated, so compiling into a directory never deletes a file that was
already there. Generation is also still staged and renamed into place, so a run
that fails part-way leaves the output directory exactly as it found it.
