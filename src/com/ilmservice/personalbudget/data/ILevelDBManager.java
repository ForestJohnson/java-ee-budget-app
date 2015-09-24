package com.ilmservice.personalbudget.data;

import java.io.Closeable;
import java.io.IOException;
import java.util.function.Function;

import org.iq80.leveldb.DB;
import org.iq80.leveldb.DBIterator;
import org.iq80.leveldb.ReadOptions;
import org.iq80.leveldb.WriteBatch;

public interface ILevelDBManager extends Closeable {
	
    public DB get();
//
//    public <R> R atomicWrite(DB db, Function<WriteBatch, R> action) throws IOException;
//
//    public <R> R withIterator(DB db, ReadOptions readOptions, Function<DBIterator, R> action) throws IOException;

}
