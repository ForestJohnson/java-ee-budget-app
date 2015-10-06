package com.ilmservice.repository;

import java.io.IOException;
import java.util.Iterator;
import java.util.Map.Entry;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.stream.Stream;

public interface IDbManager  {
	
	IDbIndex index(short indexId);
	IDbTransaction openTransaction();
	
	public interface IDbIndex {
		byte[] get(byte[] key);
		void put(byte[] key, byte[] value);
		void delete(byte[] key);
		Stream<byte[]> stream( byte[] from, byte[] until, boolean descending);
	}
	
	public interface IDbTransaction {
		IDbIndex index(short indexId);
		void execute()  throws Exception;
		void close() throws IOException;
	}
}
