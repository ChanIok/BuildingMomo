package main

import (
	"buildingmomo/server/internal/httpapi"
	"buildingmomo/server/internal/room"
	"buildingmomo/server/internal/storage"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	if err := run(); err != nil {
		slog.Error("momo-server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	command := "serve"
	args := os.Args[1:]
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		command = args[0]
		args = args[1:]
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	dbPath := flags.String("db", env("MOMO_DB_PATH", "./data/momo.sqlite"), "SQLite database path")
	addr := flags.String("listen", env("MOMO_LISTEN", "127.0.0.1:8788"), "HTTP listen address")
	file := flags.String("file", "", "migration or backup file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	store, err := storage.Open(*dbPath)
	if err != nil {
		return err
	}
	defer store.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	switch command {
	case "import", "verify":
		if *file == "" {
			return fmt.Errorf("%s requires -file", command)
		}
		f, err := os.Open(*file)
		if err != nil {
			return err
		}
		defer f.Close()
		if command == "verify" {
			if err := store.Verify(ctx, f); err != nil {
				return err
			}
			fmt.Println("Verified all rooms, documents, allocators, conflict indexes and receipts")
			return nil
		}
		return store.Import(ctx, f)
	case "export":
		if *file == "" {
			return errors.New("export requires -file")
		}
		return writeExclusive(*file, func(w io.Writer) error { return store.Export(ctx, w) })
	case "backup":
		if *file == "" {
			return errors.New("backup requires -file")
		}
		return store.Backup(ctx, *file)
	case "list":
		entries, err := store.List(ctx)
		if err != nil {
			return err
		}
		for _, m := range entries {
			fmt.Printf("%s\t%s\t%s\trev=%d\titems=%d\n", m.ObjectID, m.RoomCode, m.Scheme.Name, m.Revision, m.Scheme.ItemCount)
		}
		return nil
	case "serve":
	default:
		return fmt.Errorf("unknown command %q", command)
	}
	config, err := httpapi.ConfigFromEnv()
	if err != nil {
		return err
	}
	manager := room.New(store, 5*time.Minute)
	sweepCtx, stopSweep := context.WithCancel(context.Background())
	defer stopSweep()
	go manager.Sweep(sweepCtx)
	api := httpapi.New(config, store, manager)
	server := &http.Server{Addr: *addr, Handler: api.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10}
	done := make(chan error, 1)
	go func() {
		slog.Info("momo-server listening", "address", *addr, "origin", config.Origin)
		done <- server.ListenAndServe()
	}()
	select {
	case err = <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	shutdown, stop := context.WithTimeout(context.Background(), 20*time.Second)
	defer stop()
	// Mark rooms draining and finish any in-progress durable commit before closing
	// WebSockets. net/http.Shutdown alone does not wait for hijacked connections.
	roomErr := manager.Close(shutdown)
	httpErr := server.Shutdown(shutdown)
	return errors.Join(roomErr, httpErr)
}
func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
func writeExclusive(path string, write func(io.Writer) error) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if _, err = os.Stat(absolute); !os.IsNotExist(err) {
		return errors.New("output must not exist")
	}
	f, err := os.CreateTemp(filepath.Dir(absolute), ".momo-export-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err = write(f); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	// Link is an exclusive publication, unlike rename which can overwrite a file
	// created after the initial existence check.
	return os.Link(temp, absolute)
}
