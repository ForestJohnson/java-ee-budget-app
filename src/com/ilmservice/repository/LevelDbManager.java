package com.ilmservice.repository;

import javax.annotation.PreDestroy;
import javax.ejb.Singleton;
import javax.ejb.Stateless;
import javax.enterprise.inject.Default;
import org.iq80.leveldb.*;
import static org.iq80.leveldb.impl.Iq80DBFactory.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.WeakHashMap;
import java.util.Map.Entry;
import java.util.function.Function;

@Singleton
@Default
public class LevelDbManager implements IDbManager {

	private final String fileName = "testLevelDb5";
	private final Map<Short, LevelDbIndex> indexes;
	private final DB db;
	
	private LevelDbManager () throws IOException {
		Options options = new Options();
		options.createIfMissing(true);
		options.compressionType(CompressionType.NONE);
		db = factory.open(new File(fileName), options);
		System.out.println("DB opened");
		
		this.indexes = new HashMap<Short, LevelDbIndex>();
	}
	@Override
	public IDbIndex index(short indexId) {
		return indexes.computeIfAbsent(indexId, (id) -> {
			return new LevelDbIndex(id, db);
		});
	}
	
	@Override
	public IDbTransaction openTransaction () {
		return new LevelDbTransaction(db.createWriteBatch(), this);
	}
	
	@PreDestroy
	public void close() {
		System.out.println("DB closing");
		try {
			db.close();
		} catch (IOException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		System.out.println("DB closed");
	}
	
	class LevelDbTransaction implements IDbTransaction {
		
		private WriteBatch batch;
		private LevelDbManager manager;
		
		LevelDbTransaction (WriteBatch batch, LevelDbManager manager) {
			this.batch = batch;
			this.manager = manager;
		}

		public IDbIndex index(short indexId) {
			return manager.index(indexId);
		}
		
		@Override
		public void close() throws IOException {
			this.batch.close();
		}
		
		@Override
		public void execute() throws DBException {
			db.write(batch);
		}
	}
	
	public class LevelDbIndex implements IDbIndex {
		
		private final short index;
		private final DB levelDb;
		
		public LevelDbIndex(short index, DB levelDb) {
			this.index = index;
			this.levelDb = levelDb;
		}
		
		@Override
		public byte[] get(byte[] key) {
			return levelDb.get(getKey(index, key));
		}

		@Override
		public void put(byte[] key, byte[] value) {
			levelDb.put(getKey(index, key), value);
		}
		
		@Override
		public void delete(byte[] key) {
			levelDb.delete(getKey(index, key));
		}

		@Override
		public <V> V withIterator(
				byte[] from, 
				byte[] until, 
				boolean descending, 
				Function<Iterator<byte[]>, V> action) {
			V result = null;
			try(DBIterator iterator = levelDb.iterator()) {
				
//				if(descending && from == null) {
//					byte[] firstOfNextIndex = getKey((short)(index.getValue()+1), new byte[1]);
//					iterator.seek(firstOfNextIndex);
//					if(iterator.hasPrev()) {
//						if(ByteArrayComparator.compare(iterator.peekPrev().getKey(), firstOfNextIndex) == 0) {
//							from = iterator.prev().getKey();	
//						}
//					}
//				}
				
				byte[] firstOfIndex = getKey(index, new byte[1]);
				byte[] firstOfNextIndex = getKey((short)(index+1), new byte[1]);
				
				from = from != null ?  getKey(index, from) : (descending ? firstOfNextIndex : firstOfIndex);
						
				until = until != null ? getKey(index, until) : (descending ? firstOfIndex : firstOfNextIndex);
				
				result = action.apply(new LevelDbIterator(
						iterator,
						from,
						until,
						descending
						));
			} catch (IOException e) {
				e.printStackTrace();
			}
			return result;
		}
		
		private byte[] getKey (short index, byte[] keyValue) {
			return ByteBuffer.allocate(2+keyValue.length).putShort(index).put(keyValue).array();
		}
		
		private class LevelDbIterator implements Iterator<byte[]> {

			private final DBIterator underlying;
			//private final byte[] from;
			private final byte[] until;
			private final boolean descending;
			private Entry<byte[], byte[]> next;
			
			public LevelDbIterator (
					DBIterator underlying, 
					byte[] from, 
					byte[] until, 
					boolean descending) {
				this.underlying = underlying;
				//this.from = from;
				this.until = until;
				this.descending = descending;
				underlying.seek(from);
			}

			@Override
			public boolean hasNext() {
				if(descending ? underlying.hasPrev() : underlying.hasNext() ) {
					next = descending ? underlying.prev() : underlying.next();
					int nextKeyCompared = ByteArrayComparator.compare(next.getKey(), until);
					if( (descending && nextKeyCompared >= 0) || (!descending && nextKeyCompared < 0)) {
						return true;
					}
				}
				next = null;
				return false;
			}
			
			@Override
			public byte[] next() {
				return next.getValue();
			}
			
		}
	}

}


