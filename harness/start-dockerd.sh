#!/bin/bash
exec dockerd --host=unix:///var/run/docker.sock
