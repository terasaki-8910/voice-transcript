# Convenience entry points. Real logic is scripts/run.sh (POSIX).
.DEFAULT_GOAL := all
.PHONY: intake criteria design plan build accept integrate all
intake criteria design plan build accept integrate all:
	@sh scripts/run.sh $@
